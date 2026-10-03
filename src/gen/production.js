import facts from '../block-facts.json' with { type: 'json' };
import { getProductionMachine } from '../catalog.js';
import { analyzeFlow, describeBlock } from '../flow.js';
import { blockSize, footprint, ringCells, rectCenter } from '../geometry.js';
import { buildLogicProgram } from '../logic.js';
import { addProcessor, addDroneDock } from './dock.js';
import { addStorage } from './extras.js';
import { itemConfig } from './frame.js';
import { addExternalPort, addPlant, connectPower, powerDemand, writeNodeLinks } from './power.js';
import { addHeat, addLiquidSupply } from './machines.js';
import { routeLanes } from './lanes.js';
import { lanesForBelt, planCount, rateTarget, reportRate } from './rate.js';
import { blockName, itemName } from './profile.js';

const rectOf = (startX, startY, size) => ({ startX, startY, endX: startX + size - 1, endY: startY + size - 1, size });
const key = cell => `${cell.x},${cell.y}`;

/** Free machine rectangles that touch the core, with the cells where an unloader touches both core and machine. */
function ringPlacements(frame, machineId) {
  const board = frame.board;
  const core = frame.coreRect;
  const m = blockSize(machineId);
  const placements = [];
  const coreRing = ringCells(core).map(cell => key(cell));
  const options = [];
  for (let offset = -m + 1; offset <= core.size - 1; offset += 1) {
    options.push({ side: 2, startX: core.startX - m, startY: core.startY + offset });
    options.push({ side: 0, startX: core.endX + 1, startY: core.startY + offset });
    options.push({ side: 1, startX: core.startX + offset, startY: core.endY + 1 });
    options.push({ side: 3, startX: core.startX + offset, startY: core.startY - m });
  }
  for (const option of options) {
    const rect = rectOf(option.startX, option.startY, m);
    if (!board.rectFree(rect)) continue;
    const machineRing = ringCells(rect);
    const cells = machineRing.filter(cell => coreRing.includes(key(cell)) && board.isFree(cell.x, cell.y));
    // The machine must actually touch the core (not only a corner of it).
    const touches = machineRing.some(cell => board.tileAt(cell.x, cell.y) === frame.core);
    if (!touches) continue;
    placements.push({ ...option, rect, cells });
  }
  return placements;
}

/** Ring design: unloaders touch the core and the machine, the machine dumps output straight into the core. */
function buildRing(frame, machineId, recipe, count, { unloaders = true } = {}) {
  const board = frame.board;
  const items = unloaders ? Object.keys(recipe.inputs ?? {}) : [];
  const placed = [];
  const blockedUnloaders = new Set();
  for (let index = 0; index < count; index += 1) {
    const candidates = ringPlacements(frame, machineId)
      .map(entry => ({ ...entry, usable: entry.cells.filter(cell => !blockedUnloaders.has(key(cell))) }))
      .filter(entry => entry.usable.length >= items.length)
      .sort((a, b) => (a.side === 2 ? 0 : 1) - (b.side === 2 ? 0 : 1) || b.usable.length - a.usable.length || Math.abs(a.startY - frame.coreRect.startY) - Math.abs(b.startY - frame.coreRect.startY));
    const choice = candidates[0];
    if (!choice) break;
    const machine = board.placeAtStart(machineId, choice.startX, choice.startY, 0, null, { role: 'machine' });
    if (!machine) break;
    items.forEach((item, itemIndex) => {
      const cell = choice.usable[itemIndex];
      const tile = board.place(frame.profile.unloader, cell.x, cell.y, 0, itemConfig(item), { role: 'unloader', item });
      if (tile) blockedUnloaders.add(key(cell));
    });
    placed.push(machine);
  }
  return placed;
}

/**
 * Hub design (Erekir): [container][directional unloaders][machine][core]. The machine touches the core, so output
 * is delivered directly; the container is filled from outside through a labelled inlet.
 */
function buildHub(frame, machineId, recipe, count) {
  const board = frame.board;
  const items = Object.keys(recipe.inputs ?? {});
  const core = frame.coreRect;
  const m = blockSize(machineId);
  const hubId = items.length > 2 ? 'reinforced-vault' : 'reinforced-container';
  const hubSize = blockSize(frame.has(hubId) ? hubId : 'reinforced-container');
  const machines = [];
  const centerY = core.startY + Math.floor((core.size - 1) / 2);
  const rowsStep = m + 1;
  for (let index = 0; index < count; index += 1) {
    const dir = index % 2 === 0 ? 1 : -1;
    const slot = Math.ceil(index / 2) * dir;
    const startY = centerY - Math.floor((m - 1) / 2) + slot * rowsStep * (index === 0 ? 0 : 1);
    const startX = core.startX - m;
    const rect = rectOf(startX, startY, m);
    if (startY + m - 1 < core.startY || startY > core.endY) continue; // must overlap the core face
    if (!board.rectFree(rect)) continue;
    const unloaderX = startX - 1;
    const hubStartX = unloaderX - hubSize;
    const rows = Array.from({ length: Math.min(items.length, m) }, (_, offset) => startY + offset);
    const hubStartY = Math.min(rows[0], frame.board.height - hubSize);
    const hubRect = rectOf(hubStartX, hubStartY, hubSize);
    if (!board.rectFree(rect) || !board.rectFree(hubRect)) continue;
    const machine = board.placeAtStart(machineId, startX, startY, 0, null, { role: 'machine' });
    const hub = board.placeAtStart(frame.has(hubId) ? hubId : 'reinforced-container', hubStartX, hubStartY, 0, null, { role: 'hub' });
    if (!machine || !hub) continue;
    items.slice(0, rows.length).forEach((item, itemIndex) => {
      board.place(frame.profile.unloader, unloaderX, rows[itemIndex], 0, itemConfig(item), { role: 'unloader', item });
    });
    // Inlet: a duct entering the container from the west.
    const inletCell = { x: hubStartX - 1, y: hubStartY };
    if (board.isFree(inletCell.x, inletCell.y)) {
      board.place(frame.belt(2), inletCell.x, inletCell.y, 0, null, { role: 'inlet', lane: true });
      frame.inlet({ x: inletCell.x, y: inletCell.y, kind: 'item', id: null });
    }
    frame.require(`Наполни контейнер: ${items.map(item => `«${itemName(item)}»`).join(', ')} (вход — лента слева от контейнера).`);
    machines.push(machine);
  }
  return machines;
}

/** Lane design: dedicated lanes from supplies to ports on the outer faces; machines hug an output trunk to the core. */
function buildLanes(frame, machineId, recipe, count, { style = 'north' } = {}) {
  const board = frame.board;
  const items = Object.keys(recipe.inputs ?? {});
  const core = frame.coreRect;
  const m = blockSize(machineId);
  const yc = core.startY + Math.floor((core.size - 1) / 2);
  // Styles: 'north' fills the north side first, 'south' the south side first, 'staggered' puts the two machines in different columns.
  const flip = style === 'south';
  const staggered = style === 'staggered';
  const wide = style === 'wide';
  const trunkEnd = core.startX - 1;
  const nNorth = flip ? Math.floor(count / 2) : Math.ceil(count / 2);
  const nSouth = count - nNorth;
  const columns = staggered ? count : Math.max(nNorth, nSouth);
  const spacing = m + 1 + Math.max(0, items.length - m);
  const firstX = trunkEnd - 2 - m + 1 - (wide ? 3 : 0);
  const trunkWest = firstX - (columns - 1) * spacing;
  const machines = [];
  const placeMachine = (column, north) => {
    const startX = firstX - column * spacing;
    const startY = north ? yc + 1 : yc - m;
    return board.placeAtStart(machineId, startX, startY, 0, null, { role: 'machine' });
  };
  if (staggered) {
    for (let index = 0; index < count; index += 1) {
      const north = index % 2 === 0;
      const tile = placeMachine(index, north);
      if (tile) machines.push({ tile, north });
    }
  } else {
    for (let column = 0; column < columns; column += 1) {
      if (column < nNorth) { const tile = placeMachine(column, true); if (tile) machines.push({ tile, north: true }); }
      if (column < nSouth) { const tile = placeMachine(column, false); if (tile) machines.push({ tile, north: false }); }
    }
  }
  // Output trunk: machines dump into it, it flows east into the core.
  const rate = (Object.values(recipe.output ?? {})[0] ?? 1) * 60 / recipe.craftTime * machines.length;
  const belt = frame.belt(rate);
  for (let x = trunkWest; x <= trunkEnd; x += 1) board.place(belt, x, yc, 0, null, { role: 'trunk', lane: true });

  // Input lanes: one per (machine, item). Ports use the outer face first, then the west and east faces.
  const jobs = [];
  for (const entry of machines) {
    const rect = footprint(entry.tile);
    items.forEach((item, index) => {
      const face = Math.floor(index / m);
      const offset = index % m;
      let port;
      if (face === 0) port = { x: rect.startX + offset, y: entry.north ? rect.endY + 1 : rect.startY - 1, rotation: entry.north ? 3 : 1 };
      else if (face === 1) port = { x: rect.startX - 1, y: (entry.north ? rect.startY : rect.endY) + (entry.north ? offset : -offset), rotation: 0 };
      else port = { x: rect.endX + 1, y: (entry.north ? rect.startY : rect.endY) + (entry.north ? offset : -offset), rotation: 2 };
      jobs.push({ entry, item, north: entry.north, portX: port.x, portY: port.y, rotation: port.rotation, rate: (recipe.inputs[item] ?? 1) * 60 / recipe.craftTime });
    });
  }
  const failed = routeLanes(frame, jobs.map(job => ({ item: job.item, north: job.north, port: { x: job.portX, y: job.portY, rotation: job.rotation }, rate: job.rate })));
  return { machines: machines.map(entry => entry.tile), failed };
}

/**
 * Comb design: two dense rows of machines hugging one output trunk — machines stand shoulder to shoulder
 * because every ingredient arrives on its own distribution lane that runs the length of the row, one row per
 * ingredient, stacked outwards. An underflow gate on a lane fills the machine beside it and only passes the
 * surplus on to the next one, so a single lane feeds a whole row of machines.
 *
 * That is what makes the layout scale. The "one lane per machine" design below is limited by how many
 * unloaders fit around the core — about eight, so four two-ingredient machines — and beyond that it simply
 * refuses to place more. Here the number of machines is limited by the canvas and by how much one belt can
 * carry, which is the real limit in the game too.
 *
 * Requires the core to be unloadable (Erekir cannot do that) and no more ingredients than the machine has
 * cells on a face, since each ingredient gets its own column of the outer face.
 */
function buildComb(frame, machineId, recipe, count) {
  const board = frame.board;
  const items = Object.keys(recipe.inputs ?? {});
  const m = blockSize(machineId);
  if (!items.length || items.length > m || !frame.profile.coreUnloadable) return { machines: [], failed: 0 };
  const core = frame.coreRect;
  const yc = core.startY + Math.floor((core.size - 1) / 2);
  const trunkEnd = core.startX - 1;
  const perSecond = item => (recipe.inputs[item] ?? 1) * 60 / recipe.craftTime;
  const capacity = (frame.profile.belts.filter(entry => frame.has(entry.id)).at(-1) ?? frame.profile.belts[0]).rate;
  // One lane carries every machine of its row, so a row cannot be longer than the belt it runs on.
  const perRow = Math.max(1, Math.floor(capacity / Math.max(0.001, ...items.map(perSecond))));
  const fit = Math.max(0, Math.floor((trunkEnd - frame.soft.minX) / m));
  const north = Math.min(Math.ceil(count / 2), perRow, fit);
  const south = Math.min(count - north, perRow, fit);
  const gate = frame.spineGate();
  if (!north && !south) return { machines: [], failed: 0 };

  const all = [];
  let trunkRate = 0;
  for (const [isNorth, take] of [[true, north], [false, south]]) {
    if (!take) continue;
    const inward = isNorth ? 3 : 1;              // rotation of a lane cell pointing into the machines
    const outward = isNorth ? 1 : 3;             // direction from the machines out to their feed lane
    const machineStartY = isNorth ? yc + 1 : yc - m;
    const portRow = isNorth ? yc + m + 1 : yc - m - 1;
    // Lanes stack outwards from the row just beyond the ports. The unloader on the core face spits into
    // `feedRow`, which is not always that row — a big machine pushes the ports further out than the core's
    // face — so a riser bridges the difference.
    const feedRow = isNorth ? core.endY + 2 : core.startY - 2;
    // A lane must clear the row the unloaders stand on, which is not always the row next to the ports: a
    // small machine sits closer to the core than the core's own face.
    const laneBase = isNorth ? Math.max(portRow + 1, feedRow) : Math.min(portRow - 1, feedRow);
    const laneRow = index => (isNorth ? laneBase + index : laneBase - index);
    const placed = [];
    // One spare column between the row and the core: the riser that lifts each ingredient from the core face
    // runs there, and a machine touching it would dump its product straight into the feed lane.
    for (let column = 0; column < take; column += 1) {
      const startX = trunkEnd - m - column * m;
      if (startX < frame.soft.minX) break;
      const tile = board.placeAtStart(machineId, startX, machineStartY, 0, null, { role: 'machine' });
      if (!tile) break;
      placed.push(tile);
    }
    if (!placed.length) continue;
    all.push(...placed);
    trunkRate += (Object.values(recipe.output ?? {})[0] ?? 1) * 60 / recipe.craftTime * placed.length;

    // Feed lanes: the ingredient's unloader sits on the core face, its lane runs along the row.
    const faceCells = frame.coreFace(outward).sort((a, b) => a.x - b.x);
    if (faceCells.length < items.length) { frame.fail('На грани ядра не хватило места для разгрузчиков.'); continue; }
    const rects = placed.map(tile => footprint(tile));
    for (const [index, item] of items.entries()) {
      const row = laneRow(index);
      const unloader = board.place(frame.profile.unloader, faceCells[index].x, faceCells[index].y, 0, itemConfig(item), { role: 'unloader', item, ignoreReservation: true });
      if (!unloader) { frame.fail(`Не удалось поставить разгрузчик для «${itemName(item)}».`); continue; }
      const startX = faceCells[index].x;
      const taps = rects.map(rect => ({ x: rect.startX + index, y: row }));
      const westMost = Math.min(...taps.map(tap => tap.x));
      const belt = frame.belt(perSecond(item) * placed.length);
      // The riser carries this ingredient from the core face out to its own lane row, stepping over the
      // lanes of the ingredients before it.
      const riserSteps = Math.abs(laneRow(index) - feedRow);
      for (let step = 0; step < riserSteps; step += 1) {
        const y = isNorth ? feedRow + step : feedRow - step;
        board.place(belt, startX, y, outward, null, { role: 'riser', lane: true });
      }
      for (let x = startX; x >= westMost; x -= 1) {
        const tap = taps.some(candidate => candidate.x === x);
        board.place(tap && gate ? gate : belt, x, row, describeBlock(gate ?? belt).rotates ? 2 : (tap ? 0 : 2), null, { role: tap ? 'gate' : 'feed', lane: true });
      }
      // Teeth: the port on the machine's outer face, and junctions through the lanes stacked above it.
      for (const rect of rects) {
        const x = rect.startX + index;
        // The tooth drops through every lane stacked between its own lane and the machine's face; each of
        // those crossings becomes a junction so both the lane and the tooth keep flowing.
        const crossings = Math.abs(laneRow(index) - portRow) - 1;
        for (let step = 0; step < crossings; step += 1) {
          const y = isNorth ? portRow + 1 + step : portRow - 1 - step;
          const junctionId = frame.profile.junction;
          if (junctionId && frame.has(junctionId)) board.place(junctionId, x, y, 0, null, { role: 'junction', ignoreReservation: true });
        }
        board.place(belt, x, portRow, inward, null, { role: 'port', lane: true });
      }
    }
  }
  if (!all.length) return { machines: [], failed: 0 };
  // The trunk collects every machine's output and walks it into the core.
  const westMost = Math.min(...all.map(tile => footprint(tile).startX));
  const trunkBelt = frame.belt(trunkRate);
  for (let x = westMost; x <= trunkEnd; x += 1) board.place(trunkBelt, x, yc, 0, null, { role: 'trunk', lane: true });
  return { machines: all, failed: 0, trunk: { row: yc, westMost, rate: trunkRate } };
}

/** Flow complaints that only mean "the grid is not built yet", so a mid-build probe ignores them. */
const powerOnlyCodes = new Set(['power-source', 'power-external', 'power-deficit', 'power-missing']);

export function buildProduction(frame) {
  const settings = frame.settings;
  // `frame.board` is read fresh everywhere below: a design is adopted from a trial copy, which swaps the board.
  const machineId = getProductionMachine(frame.planet, settings.goal, frame.stage);
  frame.placeCore({ marginEast: 3 });
  if (!machineId) { frame.fail('Для этого продукта нет рецепта на выбранной планете.'); return { goalId: settings.goal, label: itemName(settings.goal) }; }
  const recipe = facts[machineId];
  const items = Object.keys(recipe.inputs ?? {});
  const erekir = frame.planet === 'erekir';
  const mode = settings.supplyMode;
  const area = frame.width * frame.height;
  const outputRate = (Object.values(recipe.output ?? {})[0] ?? 1) * 60 / recipe.craftTime;
  // Area-driven sizing keeps the old behaviour; a target the player typed overrides it. The cap is generous
  // on purpose (a machine plus its share of lanes and trunk), and each design trims further on its own.
  const byArea = Math.max(1, Math.min(4, Math.round(area / 170)));
  const machineCap = Math.max(1, Math.floor(area / (blockSize(machineId) ** 2 * 2.4)));
  const target = rateTarget(settings, 'production');
  const plan = planCount({ target, per: outputRate, min: 1, max: machineCap });
  const wanted = plan.count ?? byArea;

  let machines = [];
  let design = 'ring';
  const m = blockSize(machineId);
  const ringAllowed = !erekir && mode !== 'local' && items.length <= 2;
  // The comb feeds machines from the core through shared lanes, so it needs an unloadable core and no more
  // ingredients than the machine has cells on the face the teeth go into.
  const combAllowed = !erekir && mode !== 'local' && items.length <= m && items.length > 0;
  // Candidate designs by variant: ring (or hub on Erekir) first when the recipe allows it, then dedicated lanes.
  const compact = ringAllowed || (erekir && items.length <= 3);
  const second = Math.min(wanted, 2) >= 2 ? 'staggered' : 'south';
  const lanesStyle = compact ? (frame.variant === 2 ? second : 'north') : ['north', second, 'wide'][frame.variant % 3];
  /**
   * Every design is tried on a throw-away copy and only kept when it delivers: a half-built attempt would
   * leave machines without feeds, and the player would see a broken blueprint instead of a smaller one.
   */
  const tried = [];
  const attempt = (name, build, enough) => {
    const trial = frame.fork();
    const built = build(trial);
    if (!built?.machines?.length) return null;
    if (enough && !enough(built)) return null;
    frame.adopt(trial);
    tried.push(name);
    return built;
  };

  if (mode === 'drones') {
    // Drones carry the ingredients: the machine only needs to touch the core so output goes straight in. With no lanes to
    // reshape, the three variants are real alternatives of scale: two factories, a single one, or three.
    // With a target the three variants are no longer "two, one or three factories": the number is the answer
    // to what the player asked for, so every variant builds the same amount and only shifts the layout.
    const factories = target == null ? [Math.min(wanted, 2), 1, 3][frame.variant % 3] : wanted;
    machines = buildRing(frame, machineId, recipe, factories, { unloaders: false });
    design = 'drones';
  }
  // The comb scales with the canvas, so it takes over as soon as more than a couple of machines are needed:
  // the ring has no belts at all and is the tightest answer for one or two, but it runs out of core faces.
  // Variants 1 and 2 stay with dedicated lanes so that the three candidates are genuinely different.
  const enoughForTarget = built => target == null || built.machines.length >= Math.min(wanted, 3);
  if (!machines.length && frame.variant === 0 && ringAllowed) {
    const built = attempt('ring', trial => ({ machines: buildRing(trial, machineId, recipe, wanted) }), enoughForTarget);
    if (built) { machines = built.machines; design = 'ring'; }
  }
  if (!machines.length && combAllowed && frame.variant === 0) {
    const built = attempt('comb', trial => buildComb(trial, machineId, recipe, wanted), enoughForTarget);
    if (built) { machines = built.machines; design = 'comb'; }
  }
  if (!machines.length && frame.variant === 0 && ringAllowed) {
    const built = attempt('ring', trial => ({ machines: buildRing(trial, machineId, recipe, wanted) }));
    if (built) { machines = built.machines; design = 'ring'; }
  }
  if (!machines.length && frame.variant === 0 && erekir && items.length <= 3) {
    const built = attempt('hub', trial => ({ machines: buildHub(trial, machineId, recipe, Math.min(wanted, 2)) }));
    if (built) { machines = built.machines; design = 'hub'; }
  }
  if (!machines.length) {
    design = 'lanes';
    // Fewer machines when the core runs out of unloader cells or lanes cannot be routed. A target is worth
    // trying harder for: start from the full number and only give up when a trial really cannot route it.
    // Dedicated lanes are searched by permutation, so the cost explodes with the number of machines: past four
    // they are not the right shape anyway (that is what the comb is for), so the search stops there.
    let lanes = target == null ? Math.min(wanted, 2) : Math.min(wanted, 4);
    // A trial has to run as well as fit: a machine whose output has nowhere to go but back into its own input
    // line is worse than one machine less, so the number comes down until the flow checker is happy.
    // Power is not built yet at this point, so its complaints are ignored: only transport problems count.
    const problems = frameLike => { try { const a = analyzeFlow(frameLike.scheme({ name: 'probe', description: '' })); return a.issues.filter(issue => issue.level !== 'info' && !powerOnlyCodes.has(issue.code)).length; } catch { return 0; } };
    for (; lanes > 1; lanes -= 1) {
      const trial = frame.fork();
      const before = problems(trial);
      const builtTrial = buildLanes(trial, machineId, recipe, lanes, { style: lanesStyle });
      if (builtTrial.failed === 0 && problems(trial) <= before) break;
    }
    machines = buildLanes(frame, machineId, recipe, lanes, { style: lanesStyle }).machines;
  }
  if (!machines.length) { frame.fail('Не удалось разместить фабрику.'); return { goalId: settings.goal, label: itemName(settings.goal) }; }

  // Drone docks: one processor per ingredient, each carrying its own item.
  if (['drones', 'hybrid'].includes(mode)) {
    const dockItems = mode === 'hybrid' ? [items.includes(settings.transportItem) ? settings.transportItem : items[0]] : items;
    for (const machine of machines) for (const item of dockItems.filter(Boolean)) addDroneDock(frame, { target: machine, item, optional: mode === 'hybrid' });
  } else if (settings.processorControl && !erekir && ringAllowed !== null) {
    const program = buildLogicProgram({ ...settings, direction: 'production' });
    if (program && frame.core) addProcessor(frame, { links: [frame.core, machines[0]], program, anchor: machines[0] });
  }

  for (const machine of machines) {
    addLiquidSupply(frame, machine, recipe);
    addHeat(frame, machine, recipe);
  }

  // Power.
  const powered = frame.board.tiles.some(tile => describeBlock(tile.id).powerUse > 0);
  if (powered) {
    const nodeId = frame.pick(frame.profile.node);
    if (settings.includePower) addPlant(frame, powerDemand(frame.board.tiles), rectCenter(footprint(machines[0])));
    connectPower(frame, { nodeId });
    if (!settings.includePower) { addExternalPort(frame, { nodeId }); frame.require(`Подключи внешнее питание: до ${Math.round(powerDemand(frame.board.tiles))} ед./с.`); }
    writeNodeLinks(frame);
  }
  if (settings.includeStorage) addStorage(frame);
  const produced = outputRate * machines.length;
  reportRate(frame, { direction: 'production', target, per: outputRate, count: machines.length, noun: itemName(settings.goal), blocks: `× ${blockName(machineId)}` });
  // One belt can only carry so much: past that the trunk throttles the whole line, so say it out loud.
  const trunk = lanesForBelt(frame, produced);
  if (trunk.lanes > 1) {
    frame.require(`Выход ${produced.toFixed(1)} «${itemName(settings.goal)}»/с шире одной ленты (${trunk.capacity}/с): `
      + `нужно ${trunk.lanes} параллельных линии. Снизь цель либо разведи выход по разным сторонам ядра вручную.`);
  }
  frame.note(`Производство: ${machines.length} × ${blockName(machineId)} → ≈${produced.toFixed(2)} «${itemName(settings.goal)}»/с.`);
  frame.note(design === 'drones' ? 'Фабрика стоит вплотную к ядру: выход идёт прямо в ядро, ингредиенты возят дроны.'
    : design === 'ring' ? 'Разгрузчики касаются и ядра, и фабрики: ленты не нужны, продукт уходит прямо в ядро.'
      : design === 'hub' ? 'Схема «хаб»: контейнер → разгрузчики → фабрика → ядро.'
        : design === 'comb' ? `Гребёнка: фабрики стоят вплотную двумя рядами, у каждой свой шлюз на линии «${items.map(itemName).join('» и «')}»; шлюз наполняет фабрику и только потом пускает излишек дальше.`
          : 'Отдельная линия на каждый ингредиент; выход собирает общая лента к ядру.');
  return { goalId: settings.goal, label: itemName(settings.goal), machines, design };
}
