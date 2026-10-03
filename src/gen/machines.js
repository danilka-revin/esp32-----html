import { describeBlock } from '../flow.js';
import { blockSize, footprint, rectCenter, ringCells } from '../geometry.js';
import { blockName, liquidName } from './profile.js';

const rectOf = (startX, startY, size) => ({ startX, startY, endX: startX + size - 1, endY: startY + size - 1, size });
const key = cell => `${cell.x},${cell.y}`;

/** Cells next to `rect` where a block of `size` fits without blocking anything. */
export function adjacentSpot(frame, rect, size, { avoid = [], prefer = null } = {}) {
  const board = frame.board;
  const blocked = new Set(avoid.map(key));
  const spots = [];
  for (let startY = rect.startY - size; startY <= rect.endY + 1; startY += 1) {
    for (let startX = rect.startX - size; startX <= rect.endX + 1; startX += 1) {
      const candidate = rectOf(startX, startY, size);
      const touching = candidate.endX >= rect.startX - 1 && candidate.startX <= rect.endX + 1 && candidate.endY >= rect.startY - 1 && candidate.startY <= rect.endY + 1
        && !(candidate.endX >= rect.startX && candidate.startX <= rect.endX && candidate.endY >= rect.startY && candidate.startY <= rect.endY);
      const edgeAdjacent = (candidate.endX === rect.startX - 1 || candidate.startX === rect.endX + 1) ? (candidate.endY >= rect.startY && candidate.startY <= rect.endY)
        : (candidate.endY === rect.startY - 1 || candidate.startY === rect.endY + 1) ? (candidate.endX >= rect.startX && candidate.startX <= rect.endX) : false;
      if (!touching || !edgeAdjacent || !board.rectFree(candidate)) continue;
      const cells = [];
      for (let y = candidate.startY; y <= candidate.endY; y += 1) for (let x = candidate.startX; x <= candidate.endX; x += 1) cells.push({ x, y });
      if (cells.some(cell => blocked.has(key(cell)))) continue;
      spots.push(candidate);
    }
  }
  if (prefer) spots.sort((a, b) => Math.hypot(rectCenter(a).x - prefer.x, rectCenter(a).y - prefer.y) - Math.hypot(rectCenter(b).x - prefer.x, rectCenter(b).y - prefer.y));
  return spots;
}

/**
 * Blocks that make a liquid inside the blueprint. Anything absent from this table can only arrive by pipe,
 * because the game has no block that produces it on its own (cryofluid, slag and the synthesised gases).
 */
const liquidProducers = {
  water: ['water-extractor', 'impulse-pump', 'rotary-pump', 'mechanical-pump'],
  oil: ['oil-extractor'],
  spores: ['cultivator'],
};

/** Liquid per second one producer makes. Only the extractor figure is one the game publishes; the pumps are
 *  quoted for the best ground water tile, so the plan stays on the safe side and asks for a whole block. */
const producerOutput = { 'water-extractor': 6.6, 'impulse-pump': 6.6, 'rotary-pump': 4.3, 'mechanical-pump': 4.3, 'oil-extractor': 6, cultivator: 3 };

/** The block that would make `liquid` here, or null when the liquid has to be piped in. */
export function liquidProducer(frame, liquid) {
  return (liquidProducers[liquid] ?? []).find(id => frame.has(id)) ?? null;
}

/** One block's share of a liquid demand, so a note can say how many were worth placing. */
export function liquidProducerRate(id, rate) {
  const per = producerOutput[id] ?? 0;
  return per > 0 ? per : rate;
}

/**
 * Liquids: either made inside the blueprint by an extractor/pump/cultivator, or a labelled pipe inlet.
 * The `liquidSource` setting decides which: 'internal' asks for a producer whenever the game has one,
 * 'external' always pipes it in, and 'auto' keeps the old habit — water is dug inside when the schematic
 * brings its own power to run the extractor, everything else arrives by pipe.
 */
export function addLiquidSupply(frame, machine, recipe, { depth = 0 } = {}) {
  const board = frame.board;
  const rect = footprint(machine);
  const mode = frame.settings.liquidSource ?? 'auto';
  for (const [liquid, rate] of Object.entries(recipe.liquids ?? {})) {
    const wantProducer = mode === 'internal' || (mode !== 'external' && liquid === 'water' && frame.settings.includePower);
    const producer = wantProducer ? liquidProducer(frame, liquid) : null;
    if (producer) {
      const per = liquidProducerRate(producer, rate);
      const count = Math.min(3, Math.max(1, Math.ceil(rate / per)));
      let placed = 0;
      const produceTiles = [];
      for (let index = 0; index < count; index += 1) {
        const spot = adjacentSpot(frame, rect, blockSize(producer), { prefer: rectCenter(rect) })[0];
        if (!spot) break;
        const tile = board.placeAtStart(producer, spot.startX, spot.startY, 0, null, { role: 'liquid-source' });
        if (tile) { placed += 1; produceTiles.push(tile); }
      }
      if (placed) {
        const needs = describeBlock(producer).powerUse > 0;
        frame.note(`${liquidName(liquid)}: ${placed} × ${blockName(producer)} рядом с «${blockName(machine.id)}» добывают жидкость внутри схемы (≈${(placed * per).toFixed(1)}/с из ${rate.toFixed(1)}/с).`);
        if (needs && !frame.settings.includePower) frame.require(`${blockName(producer)} нужна энергия: подключи внешнее питание, иначе жидкость не пойдёт.`);
        if (placed * per + 1e-9 < rate) frame.require(`Жидкости «${liquidName(liquid)}» не хватает: ${placed} × ${blockName(producer)} дают ≈${(placed * per).toFixed(1)}/с, нужно ${rate.toFixed(1)}/с — долей по трубе снаружи.`);
        // A producer can be thirsty itself (an oil rig drinks water): feed it the same way, one level deep.
        for (const tile of produceTiles) {
          const own = describeBlock(producer).liquidsRequired ?? {};
          if (depth < 1 && Object.keys(own).length) addLiquidSupply(frame, tile, { liquids: own }, { depth: depth + 1 });
        }
        continue;
      }
      if (mode === 'internal') frame.note(`«${liquidName(liquid)}» добыть внутри не вышло: рядом с «${blockName(machine.id)}» нет места — жидкость придёт по трубе снаружи.`);
    }
    // Pipe inlet touching the machine, pointing into it.
    const conduit = frame.profile.conduits.find(entry => frame.has(entry.id))?.id;
    const ring = ringCells(rect).filter(cell => board.isFree(cell.x, cell.y) && !board.reserved.has(key(cell)));
    const cell = ring.find(candidate => !board.itemHazard.has(key(candidate))) ?? ring[0];
    if (conduit && cell) {
      board.place(conduit, cell.x, cell.y, cell.toward, null, { role: 'inlet', lane: true });
      frame.inlet({ x: cell.x, y: cell.y, kind: 'liquid', id: liquid });
      frame.require(`Подай «${liquidName(liquid)}» (${rate.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}/с) в трубу у «${blockName(machine.id)}».`);
    } else frame.fail(`Нет места для входа жидкости «${liquidName(liquid)}».`);
  }
}

/** Erekir heat: electric heaters pressed against the machine, facing it. */
export function addHeat(frame, machine, recipe) {
  const need = recipe.heatRequirement ?? 0;
  if (!need) return;
  const board = frame.board;
  const heaters = ['electric-heater', 'slag-heater', 'phase-heater'].filter(id => frame.has(id));
  const heater = heaters[0];
  if (!heater) { frame.require(`Подведи тепло: нужно ${need} ед.`); return; }
  const output = describeBlock(heater).fact.heatOutput ?? 3;
  const count = Math.min(4, Math.ceil(need / output));
  const rect = footprint(machine);
  let placed = 0;
  for (let index = 0; index < count; index += 1) {
    const spot = adjacentSpot(frame, rect, blockSize(heater), { prefer: rectCenter(rect) })[0];
    if (!spot) break;
    // The heater's front must point at the machine.
    const center = rectCenter(spot);
    const target = rectCenter(rect);
    const dx = target.x - center.x;
    const dy = target.y - center.y;
    const rotation = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
    if (board.placeAtStart(heater, spot.startX, spot.startY, rotation, null, { role: 'heater' })) placed += 1;
  }
  frame.note(`Тепло: ${placed} × ${blockName(heater)} направлены на «${blockName(machine.id)}» (нужно ${need}, даёт ${placed * output}).`);
  if (placed * output < need) frame.require(`Добавь нагреватели: теплу не хватает (${placed * output} из ${need}).`);
}

