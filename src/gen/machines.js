import { describeBlock } from '../flow.js';
import { blockSize, footprint, rectCenter, ringCells } from '../geometry.js';
import { blockName } from './profile.js';

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

/** Liquids: a water extractor right next to the machine, or a labelled pipe inlet for anything else. */
export function addLiquidSupply(frame, machine, recipe) {
  const board = frame.board;
  const rect = footprint(machine);
  for (const [liquid, rate] of Object.entries(recipe.liquids ?? {})) {
    const extractor = 'water-extractor';
    if (liquid === 'water' && frame.planet === 'serpulo' && frame.has(extractor) && frame.settings.includePower) {
      const perExtractor = describeBlock(extractor).fact.output ? 0 : 6.6;
      const count = Math.min(3, Math.max(1, Math.ceil(rate / perExtractor)));
      let placed = 0;
      for (let index = 0; index < count; index += 1) {
        const spot = adjacentSpot(frame, rect, blockSize(extractor), { prefer: rectCenter(rect) })[0];
        if (!spot) break;
        if (board.placeAtStart(extractor, spot.startX, spot.startY, 0, null, { role: 'water-extractor' })) placed += 1;
      }
      if (placed) { frame.note(`Вода: ${placed} × Водяной экстрактор рядом с «${blockName(machine.id)}» подаёт воду без труб.`); continue; }
    }
    // Pipe inlet touching the machine, pointing into it.
    const conduit = frame.profile.conduits.find(entry => frame.has(entry.id))?.id;
    const ring = ringCells(rect).filter(cell => board.isFree(cell.x, cell.y) && !board.reserved.has(key(cell)));
    const cell = ring.find(candidate => !board.itemHazard.has(key(candidate))) ?? ring[0];
    if (conduit && cell) {
      board.place(conduit, cell.x, cell.y, cell.toward, null, { role: 'inlet', lane: true });
      frame.inlet({ x: cell.x, y: cell.y, kind: 'liquid', id: liquid });
      frame.require(`Подай «${liquid}» (${rate.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}/с) в трубу у «${blockName(machine.id)}».`);
    } else frame.fail(`Нет места для входа жидкости «${liquid}».`);
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

