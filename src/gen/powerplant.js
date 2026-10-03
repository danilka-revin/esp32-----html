import { describeBlock, generatorInfo } from '../flow.js';
import { blockSize, footprint, rectCenter } from '../geometry.js';
import { buildLogicProgram } from '../logic.js';
import { addProcessor } from './dock.js';
import { addStorage } from './extras.js';
import { buildSpine, firstThatFits, itemConfig } from './frame.js';
import { addExternalPort, connectPower, findFreeRect, writeNodeLinks } from './power.js';
import { availableOn, blockName, itemName, techTier } from './profile.js';
import { coreUnloader } from './supply.js';

const goalLabels = {
  solar: 'Солнечная сеть', combustion: 'Генераторы на топливе', steam: 'Паровая станция', thermal: 'Тепловая станция', reactor: 'Реакторный узел',
};

/** Solid block of identical generators near `anchor` (adjacent producers share one network). */
function cluster(frame, id, count, anchor, { shape = null } = {}) {
  const board = frame.board;
  const size = blockSize(id);
  const placed = [];
  const columns = shape?.columns ?? Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const spot = findFreeRect(board, columns * size, rows * size, anchor, { margin: 1, region: frame.soft })
    ?? findFreeRect(board, columns * size, rows * size, anchor, { margin: 0, region: frame.soft })
    ?? findFreeRect(board, columns * size, rows * size, anchor, { margin: 0 });
  if (!spot) return placed;
  for (let index = 0; index < count; index += 1) {
    const tile = board.placeAtStart(id, spot.startX + (index % columns) * size, spot.startY + Math.floor(index / columns) * size, 0, null, { role: 'generator' });
    if (tile) placed.push(tile);
  }
  return placed;
}

function addBatteries(frame, near, count) {
  const board = frame.board;
  const id = frame.has('battery') ? 'battery' : null;
  if (!id) return [];
  const placed = [];
  const rects = near.map(footprint);
  for (const rect of rects) {
    for (let x = rect.startX; x <= rect.endX && placed.length < count; x += 1) {
      for (const y of [rect.endY + 1, rect.startY - 1]) {
        if (placed.length >= count) break;
        if (board.isFree(x, y) && !board.reserved.has(`${x},${y}`)) {
          const tile = board.place(id, x, y, 0, null, { role: 'battery' });
          if (tile) placed.push(tile);
        }
      }
    }
  }
  return placed;
}

/** One node on the outline of the station, on the core's side, where the player attaches consumers. */
function addExportNode(frame, generators) {
  const board = frame.board;
  const nodeId = frame.pick(frame.profile.node);
  if (!nodeId || !generators.length) return null;
  const core = frame.coreRect;
  const ring = generators.flatMap(tile => ringCellsOf(tile)).filter(cell => board.isFree(cell.x, cell.y) && !board.reserved.has(`${cell.x},${cell.y}`));
  ring.sort((a, b) => Math.hypot(a.x - core.startX, a.y - core.startY) - Math.hypot(b.x - core.startX, b.y - core.startY));
  const cell = ring[0];
  return cell ? board.place(nodeId, cell.x, cell.y, 0, null, { role: 'power-node' }) : null;
}

function ringCellsOf(tile) {
  const rect = footprint(tile);
  const cells = [];
  for (let x = rect.startX; x <= rect.endX; x += 1) cells.push({ x, y: rect.startY - 1 }, { x, y: rect.endY + 1 });
  for (let y = rect.startY; y <= rect.endY; y += 1) cells.push({ x: rect.startX - 1, y }, { x: rect.endX + 1, y });
  return cells;
}

function finishPower(frame, { external = false, generators = [] } = {}) {
  const nodeId = frame.pick(frame.profile.node);
  addExportNode(frame, generators);
  connectPower(frame, { nodeId });
  if (external) addExternalPort(frame, { nodeId });
  writeNodeLinks(frame);
}

/**
 * Fuel lane: one unloader (core) feeding a spine with generators on both sides.
 * Variant 0: vertical T-spine; 1: horizontal battery along the lane; 2: two vertical lines in depth.
 */
function fuelSpine(frame, { consumers, fuel }) {
  const board = frame.board;
  const rect = frame.coreRect;
  const yc = rect.startY + Math.floor((rect.size - 1) / 2);
  const belt = frame.belt(2);
  const router = frame.profile.router;
  const supply = coreUnloader(frame, fuel, yc);
  if (!supply) { frame.fail('На стенке ядра нет места для разгрузчика топлива.'); return null; }
  const sideSize = Math.max(...consumers.map(entry => blockSize(entry.id)));
  const maxRows = Math.min(yc - frame.soft.minY, frame.soft.maxY - yc) - 1;
  const placed = [];
  const split = list => { const left = []; const right = []; list.forEach((consumer, index) => (index % 2 === 0 ? left : right).push(consumer)); return [left, right]; };

  if (frame.variant === 1) {
    const [left, right] = split(consumers);
    const length = Math.max(4, supply.start.x - frame.soft.minX - 2);
    const spine = buildSpine(frame, { start: supply.start, dir: 2, length, left, right, belt, router, skipFirst: 0, item: fuel });
    return { consumers: spine.consumers, router: spine.routers[0] ?? null };
  }

  const lines = frame.variant === 2 ? 2 : 1;
  const perLine = splitEvenly(consumers, lines);
  let x = supply.start.x - sideSize - 2;
  let firstRouter = null;
  let previousX = null;
  for (const group of perLine) {
    const r0 = board.place(router, x, yc, frame.planet === 'erekir' ? 2 : 0, null, { role: 'router' });
    if (!r0) break;
    firstRouter ??= r0;
    const [left, right] = split(group);
    const length = Math.max(3, Math.min(maxRows, Math.ceil(group.length / 2) + 2));
    for (const dir of [1, 3]) {
      const half = dir === 1 ? [left, right] : [right, left];
      const arm = buildSpine(frame, { start: { x, y: yc + (dir === 1 ? 1 : -1) }, dir, length, left: half[0].splice(0, Math.ceil(half[0].length / 2)), right: half[1].splice(0, Math.ceil(half[1].length / 2)), belt, router, skipFirst: 1, item: fuel });
      placed.push(...arm.consumers);
    }
    if (previousX == null) frame.connect({ start: supply.start, end: { x: x + 1, y: yc }, endRotation: 2, rate: 1, label: `топливо «${itemName(fuel)}»` });
    else frame.connect({ start: { x: previousX - 1, y: yc, dir: 2 }, end: { x: x + 1, y: yc }, endRotation: 2, rate: 1, label: 'вторая колонка' });
    previousX = x;
    x -= sideSize * 2 + 4;
  }
  return { consumers: placed, router: firstRouter };
}

function splitEvenly(list, parts) {
  const result = Array.from({ length: parts }, () => []);
  list.forEach((entry, index) => result[index % parts].push(entry));
  return result;
}

export function buildPowerPlant(frame) {
  const settings = frame.settings;
  const board = frame.board;
  const planet = frame.planet;
  const goal = ['solar', 'combustion', 'steam', 'thermal', 'reactor'].includes(settings.goal) ? settings.goal : 'thermal';
  frame.placeCore({ marginEast: 3 });
  const rect = frame.coreRect;
  const yc = rect.startY + Math.floor((rect.size - 1) / 2);
  const anchor = { x: frame.soft.minX + 6, y: yc };
  const area = frame.width * frame.height;
  const density = 0.45 + 0.3 * ((settings.compactness ?? 68) - 25) / 65;
  let generators = [];
  let supplyPower = 0;

  if (goal === 'solar') {
    const options = ['solar-panel-large', 'solar-panel'].filter(id => availableOn(id, planet));
    const id = options.find(candidate => techTier(candidate, planet) <= frame.tier) ?? options.at(-1);
    const size = blockSize(id);
    const count = Math.max(4, Math.min(id === 'solar-panel' ? 48 : 12, Math.floor(area * density * 0.5 / (size * size))));
    const shape = frame.variant === 2 ? { columns: Math.max(2, Math.ceil(count / 2)) } : frame.variant === 1 ? { columns: Math.max(2, Math.ceil(Math.sqrt(count) * 1.4)) } : null;
    generators = cluster(frame, id, count, anchor, { shape });
    supplyPower = generators.length * generatorInfo(id).power;
    addBatteries(frame, generators, 4 + frame.variant * 2);
    frame.note(`Солнечная сеть: ${generators.length} × ${blockName(id)} ≈ ${Math.round(supplyPower)} ед./с без топлива и воды.`);
  } else if (goal === 'thermal') {
    const id = planet === 'erekir' ? 'turbine-condenser' : 'thermal-generator';
    const size = blockSize(id);
    const count = Math.max(2, Math.min(10, Math.floor(area * density * 0.35 / (size * size))));
    generators = cluster(frame, id, count, anchor, { shape: frame.variant === 1 ? { columns: count } : frame.variant === 2 ? { columns: 2 } : null });
    supplyPower = generators.reduce((sum, tile) => sum + describeBlock(tile.id).powerMake, 0);
    addBatteries(frame, generators, 3);
    frame.note(`${blockName(id)}: ${generators.length} шт. ≈ ${Math.round(supplyPower)} ед./с. Ставь их на ${planet === 'erekir' ? 'паровые жерла (3×3 целиком на жерле)' : 'горячие тайлы: магма, раскалённая порода, гейзеры'} — выработка зависит от тепла.`);
  } else if (goal === 'combustion' || goal === 'steam') {
    const fuel = 'coal';
    const mainId = goal === 'steam' ? 'steam-generator' : 'combustion-generator';
    const perUnit = generatorInfo(mainId).power;
    const wanted = Math.max(4, Math.min(goal === 'steam' ? 6 : 12, Math.floor(area * density * 0.12)));
    const consumers = Array.from({ length: wanted }, () => ({ id: mainId, role: 'generator' }));
    // Steam stations need a starter that works without water; combustion generators on the same lane do that.
    if (goal === 'steam' && frame.has('combustion-generator')) consumers.push({ id: 'combustion-generator', role: 'generator' }, { id: 'combustion-generator', role: 'generator' });
    const result = fuelSpine(frame, { consumers, fuel });
    generators = result?.consumers ?? [];
    if (goal === 'steam') {
      // One water extractor per steam generator, pressed against it (liquids and power conduct by adjacency).
      let extractors = 0;
      for (const generator of generators.filter(tile => tile.id === 'steam-generator')) {
        const spot = findAdjacent(frame, footprint(generator), blockSize('water-extractor'));
        if (spot && board.placeAtStart('water-extractor', spot.startX, spot.startY, 0, null, { role: 'water-extractor' })) extractors += 1;
      }
      frame.note(`Пар: ${extractors} водяных экстракторов стоят вплотную к генераторам; на старт помогают угольные генераторы на той же линии.`);
    }
    supplyPower = generators.reduce((sum, tile) => sum + describeBlock(tile.id).powerMake, 0);
    addBatteries(frame, generators, 4);
    frame.note(`${goal === 'steam' ? 'Паровые' : 'Угольные'} генераторы: ${generators.length} шт. ≈ ${Math.round(supplyPower)} ед./с; топливо — «${itemName(fuel)}» из ядра (≈${(generators.length * (goal === 'steam' ? 0.67 : 0.5)).toFixed(1)}/с).`);
    void perUnit;
  } else if (goal === 'reactor') {
    // Try the requested orientation first, then the others, until every lane fits.
    const orientations = [frame.variant, (frame.variant + 1) % 3, (frame.variant + 2) % 3];
    generators = firstThatFits(frame, orientations, (target, orientation) => buildReactor(target, anchor, orientation)).result;
    supplyPower = generators.reduce((sum, tile) => sum + describeBlock(tile.id).powerMake, 0);
  }

  // Power controller: reserve control is meaningless here, but a processor can watch the battery bank.
  void buildLogicProgram;
  void addProcessor;
  void itemConfig;
  void rectCenter;
  const externalOnly = !generators.length;
  finishPower(frame, { external: externalOnly, generators });
  if (settings.includeStorage) addStorage(frame);
  frame.note(`Энергетический узел: ≈ ${Math.round(supplyPower)} ед./с. Подключи потребителей к силовым узлам станции.`);
  return { goalId: goal, label: goalLabels[goal] ?? 'Энергия', generators };
}

function findAdjacent(frame, rect, size) {
  const board = frame.board;
  for (let startY = rect.startY - size; startY <= rect.endY + 1; startY += 1) {
    for (let startX = rect.startX - size; startX <= rect.endX + 1; startX += 1) {
      const candidate = { startX, startY, endX: startX + size - 1, endY: startY + size - 1, size };
      const sideTouch = (candidate.endX === rect.startX - 1 || candidate.startX === rect.endX + 1) && candidate.endY >= rect.startY && candidate.startY <= rect.endY;
      const topTouch = (candidate.endY === rect.startY - 1 || candidate.startY === rect.endY + 1) && candidate.endX >= rect.startX && candidate.startX <= rect.endX;
      if ((sideTouch || topTouch) && board.rectFree(candidate)) return candidate;
    }
  }
  return null;
}

/** Thorium reactor with a cryofluid mixer glued to it, a water extractor on the mixer and fuel/titanium lanes. */
function buildReactor(frame, anchor, orientation = frame.variant) {
  const board = frame.board;
  const planet = frame.planet;
  const rect = frame.coreRect;
  const yc = rect.startY + Math.floor((rect.size - 1) / 2);
  if (planet === 'erekir') return buildFluxReactor(frame, anchor);
  const reactorId = 'thorium-reactor';
  const mixerId = 'cryofluid-mixer';
  const reactorSize = blockSize(reactorId);
  const mixerSize = blockSize(mixerId);
  const spot = findFreeRect(board, reactorSize + mixerSize + 8, reactorSize + 8, { x: rect.startX - 12, y: yc }, { margin: 1, region: frame.soft })
    ?? findFreeRect(board, reactorSize + mixerSize + 8, reactorSize + 8, { x: rect.startX - 12, y: yc }, { margin: 0 });
  if (!spot) { frame.fail('Не нашлось места для реактора.'); return []; }
  const reactor = board.placeAtStart(reactorId, spot.startX + 4, spot.startY + 4, 0, null, { role: 'reactor' });
  // Variant 0: mixer on the east side; 1: on the north side; 2: on the south side.
  const mixerStart = orientation === 1
    ? { x: spot.startX + 4 + Math.floor((reactorSize - mixerSize) / 2), y: spot.startY + 4 + reactorSize }
    : orientation === 2
      ? { x: spot.startX + 4 + Math.floor((reactorSize - mixerSize) / 2), y: spot.startY + 4 - mixerSize }
      : { x: spot.startX + 4 + reactorSize, y: spot.startY + 4 + Math.floor((reactorSize - mixerSize) / 2) };
  const mixer = board.placeAtStart(mixerId, mixerStart.x, mixerStart.y, 0, null, { role: 'mixer' });
  if (!reactor || !mixer) { frame.fail('Не удалось поставить реактор рядом с миксером.'); return reactor ? [reactor] : []; }
  const water = findAdjacent(frame, footprint(mixer), blockSize('water-extractor'));
  if (water) board.placeAtStart('water-extractor', water.startX, water.startY, 0, null, { role: 'water-extractor' });
  // Fuel and titanium lanes from the core.
  const reactorRect = footprint(reactor);
  const mixerRect = footprint(mixer);
  const mixerPort = orientation === 1 || orientation === 2
    ? { x: mixerRect.endX + 1, y: mixerRect.startY, rotation: 2 }
    : { x: mixerRect.startX + 1, y: mixerRect.endY + 1, rotation: 3 };
  const jobs = [
    { item: 'thorium', port: { x: reactorRect.startX - 1, y: reactorRect.startY + 1, rotation: 0 }, rate: 0.5 },
    { item: 'titanium', port: mixerPort, rate: 0.5 },
  ];
  const taken = new Set();
  const face = frame.coreFace(2);
  // Unloaders first: their hazard rings must exist before any lane is routed past them.
  const placedJobs = [];
  for (const job of jobs) {
    const slot = face.find(cell => !taken.has(cell.y) && board.isFree(cell.x, cell.y) && !taken.has(cell.y - 1) && !taken.has(cell.y + 1));
    if (!slot) { frame.fail('Нет места для разгрузчика у ядра.'); continue; }
    const unloader = board.place(frame.profile.unloader, slot.x, slot.y, 0, itemConfig(job.item), { role: 'unloader', item: job.item });
    if (!unloader) continue;
    taken.add(slot.y);
    placedJobs.push({ ...job, slot });
  }
  board.reserve(placedJobs.flatMap(job => [{ x: job.slot.x - 1, y: job.slot.y }, { x: job.slot.x - 2, y: job.slot.y }, { x: job.port.x, y: job.port.y }]).filter(cell => board.isFree(cell.x, cell.y)), 'lane-end');
  for (const job of placedJobs) {
    frame.connect({ start: frame.laneStart(job.slot, 2), end: { x: job.port.x, y: job.port.y }, endRotation: job.port.rotation, rate: job.rate, label: `«${itemName(job.item)}»`, allow: [{ x: job.port.x, y: job.port.y }] });
  }
  board.releaseReservation(placedJobs.flatMap(job => [{ x: job.slot.x - 1, y: job.slot.y }, { x: job.slot.x - 2, y: job.slot.y }, { x: job.port.x, y: job.port.y }]));
  frame.note('Реактор: мик­сер криожидкости прижат к реактору и охлаждает его напрямую; вода — от экстрактора на миксере. Включай реактор только при работающей подаче титана и воды.');
  frame.require('Для старта нужна энергия миксеру и экстрактору: батареи и узлы уже соединены, запусти их от любого генератора.');
  const batteries = addBatteries(frame, [reactor, mixer], 4);
  void batteries;
  return [reactor];
}

function buildFluxReactor(frame, anchor) {
  const board = frame.board;
  const id = 'flux-reactor';
  const size = blockSize(id);
  const shifted = { x: anchor.x, y: anchor.y + (frame.variant - 1) * 5 };
  const spot = findFreeRect(board, size + 6, size + 6, shifted, { margin: 1, region: frame.soft }) ?? findFreeRect(board, size + 6, size + 6, shifted, { margin: 0 });
  if (!spot) { frame.fail('Не нашлось места для реактора.'); return []; }
  const reactor = board.placeAtStart(id, spot.startX + 3, spot.startY + 3, 0, null, { role: 'reactor' });
  if (!reactor) return [];
  const conduit = frame.profile.conduits[0].id;
  const rect = footprint(reactor);
  const cell = { x: rect.startX - 1, y: rect.startY + Math.floor(size / 2) };
  board.place(conduit, cell.x, cell.y, 0, null, { role: 'inlet', lane: true });
  frame.inlet({ x: cell.x, y: cell.y, kind: 'liquid', id: 'cyanogen' });
  frame.require('Подай циан (≈9/с) в трубу у реактора и тепло от нагревателей: без него реактор не набирает мощность.');
  const heater = 'electric-heater';
  if (frame.has(heater)) {
    let count = 0;
    for (let index = 0; index < 4; index += 1) {
      const spotHeater = findAdjacent(frame, rect, blockSize(heater));
      if (!spotHeater) break;
      const center = rectCenter(spotHeater);
      const target = rectCenter(rect);
      const dx = target.x - center.x;
      const dy = target.y - center.y;
      const rotation = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      if (board.placeAtStart(heater, spotHeater.startX, spotHeater.startY, rotation, null, { role: 'heater' })) count += 1;
    }
    frame.note(`Нагреватели: ${count} шт. направлены на реактор.`);
  }
  return [reactor];
}
