import facts from '../block-facts.json' with { type: 'json' };
import { getProductionMachine } from '../catalog.js';
import { describeBlock } from '../flow.js';
import { blockSize, footprint, ringCells, rectCenter } from '../geometry.js';
import { buildLogicProgram } from '../logic.js';
import { addProcessor, addDroneDock } from './dock.js';
import { addStorage } from './extras.js';
import { itemConfig } from './frame.js';
import { addExternalPort, addPlant, connectPower, powerDemand, writeNodeLinks } from './power.js';
import { addHeat, addLiquidSupply } from './machines.js';
import { routeLanes } from './lanes.js';
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

export function buildProduction(frame) {
  const settings = frame.settings;
  const board = frame.board;
  const machineId = getProductionMachine(frame.planet, settings.goal, frame.stage);
  frame.placeCore({ marginEast: 3 });
  if (!machineId) { frame.fail('Для этого продукта нет рецепта на выбранной планете.'); return { goalId: settings.goal, label: itemName(settings.goal) }; }
  const recipe = facts[machineId];
  const items = Object.keys(recipe.inputs ?? {});
  const erekir = frame.planet === 'erekir';
  const mode = settings.supplyMode;
  const area = frame.width * frame.height;
  const wanted = Math.max(1, Math.min(4, Math.round(area / 170)));
  const outputRate = (Object.values(recipe.output ?? {})[0] ?? 1) * 60 / recipe.craftTime;

  let machines = [];
  let design = 'ring';
  const ringAllowed = !erekir && mode !== 'local' && items.length <= 2;
  // Candidate designs by variant: ring (or hub on Erekir) first when the recipe allows it, then dedicated lanes.
  const compact = ringAllowed || (erekir && items.length <= 3);
  const second = Math.min(wanted, 2) >= 2 ? 'staggered' : 'south';
  const lanesStyle = compact ? (frame.variant === 2 ? second : 'north') : ['north', second, 'wide'][frame.variant % 3];
  if (mode === 'drones') {
    // Drones carry the ingredients: the machine only needs to touch the core so output goes straight in. With no lanes to
    // reshape, the three variants are real alternatives of scale: two factories, a single one, or three.
    const factories = [Math.min(wanted, 2), 1, 3][frame.variant % 3];
    machines = buildRing(frame, machineId, recipe, factories, { unloaders: false });
    design = 'drones';
  } else if (frame.variant === 0 && ringAllowed) {
    machines = buildRing(frame, machineId, recipe, wanted);
    design = 'ring';
  } else if (frame.variant === 0 && erekir && items.length <= 3) {
    machines = buildHub(frame, machineId, recipe, Math.min(wanted, 2));
    design = 'hub';
  }
  if (!machines.length) {
    design = 'lanes';
    // Fewer machines when the core runs out of unloader cells or lanes cannot be routed.
    let lanes = Math.min(wanted, 2);
    for (; lanes > 1; lanes -= 1) {
      const trial = frame.fork();
      if (buildLanes(trial, machineId, recipe, lanes, { style: lanesStyle }).failed === 0) break;
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
  const powered = board.tiles.some(tile => describeBlock(tile.id).powerUse > 0);
  if (powered) {
    const nodeId = frame.pick(frame.profile.node);
    if (settings.includePower) addPlant(frame, powerDemand(board.tiles), rectCenter(footprint(machines[0])));
    connectPower(frame, { nodeId });
    if (!settings.includePower) { addExternalPort(frame, { nodeId }); frame.require(`Подключи внешнее питание: до ${Math.round(powerDemand(board.tiles))} ед./с.`); }
    writeNodeLinks(frame);
  }
  if (settings.includeStorage) addStorage(frame);
  frame.note(`Производство: ${machines.length} × ${blockName(machineId)} → ≈${(outputRate * machines.length).toFixed(2)} «${itemName(settings.goal)}»/с.`);
  frame.note(design === 'drones' ? 'Фабрика стоит вплотную к ядру: выход идёт прямо в ядро, ингредиенты возят дроны.' : design === 'ring' ? 'Разгрузчики касаются и ядра, и фабрики: ленты не нужны, продукт уходит прямо в ядро.' : design === 'hub' ? 'Схема «хаб»: контейнер → разгрузчики → фабрика → ядро.' : 'Отдельная линия на каждый ингредиент; выход собирает общая лента к ядру.');
  return { goalId: settings.goal, label: itemName(settings.goal), machines, design };
}
