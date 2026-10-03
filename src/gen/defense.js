import { describeBlock, turretInfo } from '../flow.js';
import { blockSize, footprint } from '../geometry.js';
import data from '../mechanics-data.json' with { type: 'json' };
import { buildSpine, itemConfig } from './frame.js';
import { addStorage, turretsAccepting } from './extras.js';
import { addDroneDock } from './dock.js';
import { addExternalPort, addPlant, connectPower, powerDemand, writeNodeLinks } from './power.js';
import { planCount, rateTarget, reportRate } from './rate.js';
import { blockName, itemName, stageTier } from './profile.js';
import { buildSupply } from './supply.js';

/** Which turrets stand in which doctrine; every set shares one ammo item so a single lane feeds all of it. */
const doctrines = {
  serpulo: {
    frontline: [['duo'], ['salvo', 'hail', 'duo'], ['ripple', 'salvo', 'duo']],
    'anti-air': [['scatter'], ['scatter'], ['cyclone', 'scatter']],
    heavy: [['hail', 'duo'], ['ripple', 'salvo'], ['spectre', 'ripple', 'salvo']],
  },
  erekir: {
    frontline: [['breach'], ['breach'], ['scathe', 'breach']],
    'anti-air': [['diffuse'], ['disperse', 'diffuse'], ['disperse', 'diffuse']],
    heavy: [['breach'], ['breach'], ['scathe', 'breach']],
  },
};

const powerTurrets = {
  serpulo: { frontline: ['lancer'], heavy: ['lancer'], 'anti-air': [] },
  erekir: { frontline: [], heavy: [], 'anti-air': [] },
};

const ammoPreference = {
  serpulo: ['graphite', 'silicon', 'metaglass', 'copper', 'lead', 'scrap', 'titanium', 'thorium', 'pyratite', 'coal'],
  erekir: ['beryllium', 'graphite', 'silicon', 'tungsten', 'oxide', 'carbide', 'thorium'],
};

const wallLadders = {
  serpulo: ['copper-wall', 'titanium-wall', 'thorium-wall'],
  erekir: ['beryllium-wall', 'tungsten-wall', 'carbide-wall'],
};

const rectCellsOf = rect => { const cells = []; for (let y = rect.startY; y <= rect.endY; y += 1) for (let x = rect.startX; x <= rect.endX; x += 1) cells.push({ x, y }); return cells; };

const goalLabels = { frontline: 'Линия фронта', 'anti-air': 'ПВО', heavy: 'Тяжёлая оборона' };

export function pickDoctrine(frame, goal) {
  const table = doctrines[frame.planet];
  const key = table[goal] ? goal : 'frontline';
  const list = table[key][Math.min(2, frame.tier)].filter(id => frame.has(id));
  const turrets = list.length ? list : table[key].flat().filter(id => frame.has(id)).slice(0, 1);
  return { goal: key, turrets };
}

/** Tier of an ammo item: how far into the game it is normally available. */
function ammoTier(planet, item) {
  const base = { copper: 0, lead: 0, scrap: 0, sand: 0, coal: 0, beryllium: 0, metaglass: 1, titanium: 1, tungsten: 1, oxide: 1, pyratite: 1, thorium: 2, carbide: 2 };
  if (item === 'graphite' || item === 'silicon') return planet === 'erekir' ? 0 : 1;
  return base[item] ?? 2;
}

/** One ammo item accepted by every turret; falls back to the best item for the first turret. */
export function pickAmmo(frame, turrets, preferred = null) {
  const accepted = turrets.map(id => new Set(turretInfo(id)?.ammo ?? []));
  const preference = ammoPreference[frame.planet];
  const shared = preference.filter(item => accepted.every(set => set.has(item)));
  if (preferred && shared.includes(preferred)) return preferred;
  const affordable = shared.filter(item => ammoTier(frame.planet, item) <= stageTier(frame.stage));
  return affordable[0] ?? shared[0] ?? preference.find(item => accepted[0]?.has(item)) ?? [...accepted[0]][0] ?? null;
}

function wallFor(frame) {
  const ladder = wallLadders[frame.planet];
  const wanted = ladder[Math.min(ladder.length - 1, frame.tier)];
  return frame.has(wanted) ? wanted : ladder.find(id => frame.has(id));
}

/** A vertical T-spine: the lane enters a router and splits into two arms with turret pairs. */
function verticalLine(frame, { x, yc, turrets, rows, router, belt, ammo, laneEnd = true, skipFirst = 1 }) {
  const board = frame.board;
  const r0 = board.place(router, x, yc, frame.planet === 'erekir' ? 2 : 0, null, { role: 'router' });
  if (!r0) return null;
  const count = Math.ceil(rows / 2) + 1;
  const west = [];
  const east = [];
  for (let index = 0; index < count; index += 1) {
    west.push({ id: turrets[index % turrets.length], role: 'turret' });
    east.push({ id: turrets[(index + 1) % turrets.length], role: 'turret' });
  }
  const placed = [];
  for (const dir of [1, 3]) {
    const start = { x, y: yc + (dir === 1 ? 1 : -1) };
    const arm = buildSpine(frame, { start, dir, length: rows, left: dir === 1 ? [...west] : [...east], right: dir === 1 ? [...east] : [...west], belt, router, skipFirst, item: ammo });
    placed.push(...arm.consumers);
  }
  return { router: r0, turrets: placed, laneEnd };
}

/** A horizontal battery: the supply lane itself is the spine and runs west with turrets above and below it. */
function horizontalBattery(frame, { start, turrets, length, router, belt, ammo }) {
  const count = Math.ceil(length / 2) + 1;
  const south = [];
  const north = [];
  for (let index = 0; index < count; index += 1) {
    south.push({ id: turrets[index % turrets.length], role: 'turret' });
    north.push({ id: turrets[(index + 1) % turrets.length], role: 'turret' });
  }
  return buildSpine(frame, { start, dir: 2, length, left: south, right: north, belt, router, skipFirst: 0, item: ammo });
}

function turretExtent(tiles, fallback) {
  const rects = tiles.map(tile => footprint(tile));
  return {
    westX: rects.length ? Math.min(...rects.map(rect => rect.startX)) : fallback.x,
    lowY: rects.length ? Math.min(...rects.map(rect => rect.startY)) : fallback.y,
    highY: rects.length ? Math.max(...rects.map(rect => rect.endY)) : fallback.y,
  };
}

export function buildDefense(frame) {
  const settings = frame.settings;
  const board = frame.board;
  const profile = frame.profile;
  const core = frame.placeCore();
  void core;
  const picked = pickDoctrine(frame, settings.goal);
  const goal = picked.goal;
  let turrets = picked.turrets;
  const importAmmo = settings.campaignLink && frame.planet === 'serpulo';
  if (importAmmo && settings.transportItem && !turrets.every(id => turretInfo(id)?.ammo.includes(settings.transportItem))) {
    // The imported item decides which turrets are worth building.
    const wantsAir = goal === 'anti-air';
    const matching = turretsAccepting(frame, settings.transportItem, { maxSize: 4, air: wantsAir ? true : null, ground: wantsAir ? null : true });
    if (matching.length) turrets = matching.slice(0, 2);
    else frame.note(`Предмет «${itemName(settings.transportItem)}» не подходит ни одной турели этого типа — оставлены штатные турели, настрой посадочную площадку на их боеприпас.`);
  }
  if (!turrets.length) { frame.fail('Для этой цели нет доступных турелей.'); return { goalId: goal, label: 'Оборона' }; }
  // Power turrets only appear when the fuel-free plant can actually run them (lancers draw 360 units/s each).
  const plantCapacity = frame.planet === 'erekir' ? 6 * 180 : frame.tier >= 2 && frame.has('solar-panel-large') ? 6 * 96 : 30 * 7.2;
  const extraPower = settings.includePower
    ? (powerTurrets[frame.planet][goal] ?? []).filter(id => frame.has(id) && plantCapacity - 200 >= describeBlock(id).powerUse)
    : [];
  const ammo = pickAmmo(frame, turrets, importAmmo ? settings.transportItem : null);
  const rect = frame.coreRect;
  const yc = rect.startY + Math.floor((rect.size - 1) / 2);
  const sizes = turrets.map(id => blockSize(id));
  const sizeWest = Math.max(...sizes);
  const sizeEast = sizes.length > 1 ? sizes[1] : sizes[0];
  const router = profile.router;
  const belt = frame.belt(2);
  const maxRows = Math.min(yc - frame.soft.minY, frame.soft.maxY - yc) - 1;
  const fill = 0.4 + 0.6 * ((settings.compactness ?? 68) - 25) / 65;
  // The defence target counts turrets, not items: a spine arm holds ceil(rows / 2) + 1 of them, two arms per line.
  const target = rateTarget(settings, 'defense');
  const plan = planCount({ target, per: 1, min: 2, max: 24 });
  const rows = plan.count == null
    ? Math.max(3, Math.min(maxRows, Math.ceil(maxRows * fill)))
    // Odd row counts: an even spine ends in a router that nothing takes from.
    : Math.max(3, Math.min(maxRows, 2 * Math.ceil(plan.count / 2) - 1));

  const supply = importAmmo ? null : buildSupply(frame, ammo, { anchorY: yc });
  const placedTurrets = [];
  let headCell;
  let lineRouter = null;
  const padId = 'landing-pad';
  const padSize = blockSize(padId);
  let padRect = null;
  const reservePad = (startX) => {
    padRect = { startX, startY: yc - Math.floor((padSize - 1) / 2), endX: startX + padSize - 1, endY: yc - Math.floor((padSize - 1) / 2) + padSize - 1, size: padSize };
    board.reserve(rectCellsOf(padRect), 'landing-pad');
  };

  if (frame.variant === 2) {
    // Horizontal battery along the supply lane.
    const nearCore = { x: rect.startX - 2 - (importAmmo ? padSize : 0) - (supply?.drones && frame.planet === 'erekir' ? 3 : 0), y: yc };
    const farSupply = Boolean(supply?.start && supply.drills);
    const laneStart = farSupply || !supply?.start ? nearCore : supply.start;
    // Drills sit far away: their lane first runs up to the battery. Core unloaders and buffer hubs start the battery directly.
    if (farSupply) frame.connect({ start: supply.start, end: { x: laneStart.x + 1, y: yc }, endRotation: 2, rate: 1, label: `боеприпас «${itemName(ammo)}»` });
    if (importAmmo && frame.has(padId)) reservePad(laneStart.x + 1);
    const length = Math.max(4, laneStart.x - frame.soft.minX - 2);
    const battery = horizontalBattery(frame, { start: laneStart, turrets, length: Math.min(length, 2 * Math.ceil(rows / 2) * Math.max(...sizes) + 2), router, belt, ammo });
    placedTurrets.push(...battery.consumers);
    headCell = battery.cells.at(-1) ?? laneStart;
    lineRouter = battery.routers[0] ?? null;
  } else {
    const westEdge = Math.min(rect.startX - 1, supply?.westEdge ?? rect.startX - 1);
    const spineX = westEdge - sizeEast - 3 - (importAmmo ? padSize - 1 : 0);
    if (importAmmo && frame.has(padId)) reservePad(spineX + 1);
    // An Erekir unload point must touch the line, so the first turret pair starts further out - but only while a pair
    // still fits behind that pocket. A Serpulo processor just has to be in laser range and needs no room at all.
    const firstExtent = Math.max(sizes[0], sizes[1 % sizes.length]);
    const dockRoom = supply?.drones && frame.planet === 'erekir' && 3 + firstExtent <= rows ? 3 : 1;
    const first = verticalLine(frame, { x: spineX, yc, turrets, rows, router, belt, ammo, skipFirst: dockRoom });
    if (!first) { frame.fail('Не хватило места для узла оборонительной линии.'); return { goalId: goal, label: 'Оборона' }; }
    placedTurrets.push(...first.turrets);
    lineRouter = first.router;
    headCell = { x: spineX, y: yc };
    if (supply?.start) frame.connect({ start: supply.start, end: { x: spineX + 1, y: yc }, endRotation: 2, rate: 1, label: `боеприпас «${itemName(ammo)}»` });
    // Defence in depth: the first router's western output feeds a second line. A target that the first line
    // already reaches is not doubled - the player asked for a number, not for the biggest wall we can build.
    if (frame.variant === 1 && (plan.count == null || placedTurrets.length < plan.count)) {
      const extent = turretExtent(first.turrets, headCell);
      const secondX = extent.westX - sizeEast - 3;
      if (secondX - sizeWest - 1 >= frame.soft.minX - 2) {
        const startCell = { x: spineX - 1, y: yc };
        const second = verticalLine(frame, { x: secondX, yc, turrets: [...turrets].reverse(), rows, router, belt, ammo, skipFirst: 1 });
        if (second) {
          frame.connect({ start: startCell, end: { x: secondX + 1, y: yc }, endRotation: 2, rate: 1, label: 'вторая линия обороны' });
          placedTurrets.push(...second.turrets);
          headCell = { x: secondX, y: yc };
        }
      }
    }
  }

  // Campaign import: a landing pad dumps the imported ammo straight into the first router / spine cell.
  if (importAmmo && padRect) {
    board.releaseReservation(rectCellsOf(padRect));
    const placed = board.placeAtStart(padId, padRect.startX, padRect.startY, 0, itemConfig(ammo), { role: 'landing-pad' });
    if (placed) {
      frame.note(`Посадочная площадка настроена на «${itemName(ammo)}» и подаёт его прямо в оборону; ей нужна вода для посадки грузов.`);
      const conduit = frame.profile.conduits[0].id;
      const cell = { x: padRect.startX + 1, y: padRect.endY + 1 };
      const inlet = board.place(conduit, cell.x, cell.y, 3, null, { role: 'inlet', lane: true });
      if (inlet) { frame.inlet({ x: cell.x, y: cell.y, kind: 'liquid', id: 'water' }); frame.require('Подай воду в трубу над посадочной площадкой.'); }
    } else frame.fail('Не нашлось места для посадочной площадки.');
  }

  // Drone docks go in before walls, menders and the plant so nothing else takes the pocket behind the first router.
  if (supply?.drones && lineRouter) {
    // The router first; on Erekir its neighbours in the spine are fallbacks when the router's back is taken by a lane.
    const spineTiles = board.tiles.filter(tile => ['spine', 'router'].includes(tile.meta.role) && tile !== lineRouter)
      .sort((a, b) => Math.hypot(a.x - lineRouter.x, a.y - lineRouter.y) - Math.hypot(b.x - lineRouter.x, b.y - lineRouter.y)).slice(0, 6);
    addDroneDock(frame, { targets: [lineRouter, ...spineTiles], item: ammo, optional: settings.supplyMode === 'hybrid' });
  }
  // Wall in front of the western turrets.
  const extent = turretExtent(placedTurrets, headCell);
  const wall = wallFor(frame);
  const wallX = extent.westX - 1 - (frame.variant === 1 ? 0 : 0);
  if (wall) {
    for (let y = extent.lowY; y <= extent.highY; y += 1) {
      if (board.isFree(wallX, y)) board.place(wall, wallX, y, 0, null, { role: 'wall' });
    }
    if (frame.variant === 1) {
      for (let y = extent.lowY; y <= extent.highY; y += 1) if (board.isFree(wallX - 1, y)) board.place(wall, wallX - 1, y, 0, null, { role: 'wall' });
    }
  }

  // Menders inside the wall line keep walls and turrets repaired (they need power).
  if (settings.includePower && frame.has('mender') && wall) {
    const mid = Math.round((extent.lowY + extent.highY) / 2);
    for (const y of [...new Set([extent.lowY + 1, mid, extent.highY - 1])]) {
      const old = board.tileAt(wallX, y);
      if (old && old.meta.role === 'wall') board.remove(old);
      board.place('mender', wallX, y, 0, null, { role: 'mender' });
    }
  }
  const power = [];
  if (extraPower.length) {
    for (const id of extraPower) {
      const size = blockSize(id);
      const budget = Math.max(1, Math.floor((plantCapacity - 200) / describeBlock(id).powerUse));
      for (let y = extent.lowY; y + size - 1 <= extent.highY && power.length < Math.min(4, budget); y += size + 1) {
        const tile = board.placeAtStart(id, wallX - 1 - size, y, 0, null, { role: 'turret' });
        if (tile) power.push(tile);
      }
    }
  }
  // Menders, lancers and the Erekir cargo loader all draw power: whatever is on the board decides whether a grid is needed.
  if (powerDemand(board.tiles) > 0) {
    const nodeId = frame.pick(profile.node);
    if (settings.includePower) addPlant(frame, powerDemand(board.tiles), headCell);
    connectPower(frame, { nodeId });
    if (!settings.includePower) { addExternalPort(frame, { nodeId }); frame.require('Подключи внешнее питание к силовому узлу.'); }
    writeNodeLinks(frame);
  }

  if (settings.includeStorage) addStorage(frame);
  const labels = [...new Set(turrets.map(id => blockName(id)))].join(' + ');
  frame.note(`Оборона: ${labels}; общий боеприпас «${itemName(ammo)}» подаётся одной линией через маршрутизаторы.`);
  reportRate(frame, { direction: 'defense', target, per: 1, count: placedTurrets.length, noun: 'обороны', blocks: '× турель' });
  if (data.turrets[turrets[0]]?.ground === false) frame.note('Эти турели бьют только по воздуху.');
  return { goalId: goal, label: goalLabels[goal] ?? 'Оборона', turrets: placedTurrets, ammo };
}
