import facts from '../block-facts.json' with { type: 'json' };
import { describeBlock } from '../flow.js';
import { blockSize } from '../geometry.js';
import { addStorage, turretsAccepting } from './extras.js';
import { liquidRow } from './liquids.js';
import { addExternalPort, addPlant, connectPower, powerDemand, writeNodeLinks } from './power.js';
import { blockName, drillRate, drillsFor, itemName, rawItems, techTier } from './profile.js';

/**
 * Strongest drill that can mine `item`. Powered drills need a whole power plant, so they are only chosen when
 * nothing unpowered can do the job, or when the endgame stage and the power toggle make them worthwhile.
 */
export function chooseDrill(frame, item, { allowPower = frame.settings.includePower } = {}) {
  const all = drillsFor(frame.planet, item).filter(id => frame.has(id));
  if (!all.length) return null;
  const info = id => describeBlock(id);
  let pool = all;
  const withinTier = pool.filter(id => techTier(id, frame.planet) <= frame.tier);
  if (withinTier.length) pool = withinTier;
  // Erekir burst drills need water/ozone and 160+ power; beam drills and crushers keep the module simple.
  const simple = pool.filter(id => info(id).cls !== 'BurstDrill');
  if (frame.planet === 'erekir' && simple.length) pool = simple;
  const dry = pool.filter(id => !Object.keys(info(id).liquidsRequired).length);
  if (dry.length) pool = dry;
  const unpowered = pool.filter(id => info(id).powerUse === 0);
  if (unpowered.length && !(allowPower && frame.tier >= 2)) pool = unpowered;
  return [...pool].sort((a, b) => drillRate(b, item) / blockSize(b) ** 2 - drillRate(a, item) / blockSize(a) ** 2 || blockSize(a) - blockSize(b))[0];
}

/** Largest belt rate we may plan for: the fastest lane the stage can build. */
function laneCapacity(frame) {
  const belts = frame.profile.belts.filter(entry => frame.has(entry.id) && techTier(entry.id, frame.planet) <= frame.tier);
  return (belts.at(-1) ?? frame.profile.belts[0]).rate;
}

/** Estimated generation the solar field can reach inside the canvas. */
function plantBudget(frame) {
  return frame.has('solar-panel-large') && frame.tier >= 2 ? 6 * 96 : frame.has('solar-panel') ? 30 * 7.2 : 0;
}

const rotationFor = (drill, away) => describeBlock(drill).rotates ? away : 0;

const xEndOf = frame => frame.coreRect.startX - 1;

function trunkRow(frame) {
  const core = frame.coreRect;
  return core.startY + Math.floor((core.size - 1) / 2);
}

/** Style A: one collector belt straight into the core with drills on both sides. */
function buildTrunk(frame, drill, item, plan) {
  const board = frame.board;
  const s = blockSize(drill);
  const yt = trunkRow(frame);
  const xEnd = frame.coreRect.startX - 1;
  const escort = plan.escort;
  const escortCols = escort ? blockSize(escort) : 0;
  const availableColumns = Math.floor((xEnd + 1 - frame.soft.minX - escortCols) / s);
  const wanted = Math.min(plan.maxDrills, (plan.oneSided ? 1 : 2) * availableColumns);
  const pairs = Math.max(1, plan.oneSided ? wanted : Math.ceil(wanted / 2));
  const drills = [];
  const firstStart = xEnd - escortCols;
  let westMost = xEnd - escortCols + 1;
  for (let column = 0; column < pairs; column += 1) {
    const startX = firstStart - s * (column + 1) + 1;
    if (startX < frame.soft.minX) break;
    let any = false;
    const slots = [[yt + 1, 1], [yt - s, 3]].filter((_, index) => !plan.oneSided || index === 0);
    for (const [startY, away] of slots) {
      if (drills.length >= wanted) break;
      const tile = board.placeAtStart(drill, startX, startY, rotationFor(drill, away), null, { role: 'drill' });
      if (tile) { drills.push(tile); any = true; }
    }
    if (any) westMost = startX;
  }
  const total = drills.length * drillRate(drill, item);
  const belt = frame.belt(total);
  const routerId = frame.profile.router;
  const escortRouterX = escort ? xEnd - escortCols + 1 + Math.floor((escortCols - 1) / 2) : null;
  for (let x = westMost; x <= xEnd; x += 1) {
    if (escort && x === escortRouterX) board.place(routerId, x, yt, 0, null, { role: 'router' });
    else board.place(belt, x, yt, 0, null, { role: 'trunk', lane: true });
  }
  // Drills that need a liquid get a manifold row along their outer face.
  const needs = Object.keys(describeBlock(drill).liquidsRequired);
  if (needs.length && drills.length) {
    const liquid = needs[0];
    const north = drills.filter(tile => tile.y > yt);
    const south = drills.filter(tile => tile.y < yt);
    const fromX = xEnd - escortCols;
    if (north.length) liquidRow(frame, { y: yt + s + 1, fromX, taps: [...new Set(north.map(tile => tile.x))], liquid });
    if (south.length) liquidRow(frame, { y: yt - s - 1, fromX, taps: [...new Set(south.map(tile => tile.x))], liquid });
  }
  const turrets = [];
  if (escort) {
    for (const startY of [yt + 1, yt - escortCols]) {
      const turret = board.placeAtStart(escort, xEnd - escortCols + 1, startY, 0, null, { role: 'turret' });
      if (turret) turrets.push(turret);
    }
  }
  return { drills, turrets, rate: total, belt, trunkRows: [yt] };
}

/** Style B: a trunk with vertical feeder belts ("comb"), each feeder flanked by drills. */
function buildComb(frame, drill, item, plan) {
  const board = frame.board;
  const s = blockSize(drill);
  const yt = trunkRow(frame);
  const xEnd = frame.coreRect.startX - 1;
  const escort = plan.escort;
  const escortCols = escort ? blockSize(escort) : 0;
  const pitch = 2 * s + 1 + (plan.gap ?? 0);
  const firstBranch = xEnd - escortCols - s - 1;
  const rowsNorth = Math.floor((frame.soft.maxY - yt) / s);
  const rowsSouth = Math.floor((yt - frame.soft.minY) / s);
  const perBranch = Math.max(1, rowsNorth + rowsSouth) * 2;
  const branchesWanted = Math.max(1, Math.ceil(plan.maxDrills / perBranch));
  const branchColumns = [];
  for (let column = 0; column < branchesWanted; column += 1) {
    const x = firstBranch - column * pitch;
    if (x - s < frame.soft.minX) break;
    branchColumns.push(x);
  }
  if (!branchColumns.length) return buildTrunk(frame, drill, item, plan);
  const drills = [];
  const branches = [];
  let remaining = plan.maxDrills;
  for (const x of branchColumns) {
    for (const direction of [1, -1]) {
      const rowCount = direction === 1 ? rowsNorth : rowsSouth;
      let count = 0;
      for (let row = 0; row < rowCount && remaining > 0; row += 1) {
        const startY = direction === 1 ? yt + 1 + row * s : yt - (row + 1) * s;
        const west = board.placeAtStart(drill, x - s, startY, rotationFor(drill, 2), null, { role: 'drill' });
        if (west) { drills.push(west); remaining -= 1; count += 1; }
        const east = remaining > 0 ? board.placeAtStart(drill, x + 1, startY, rotationFor(drill, 0), null, { role: 'drill' }) : null;
        if (east) { drills.push(east); remaining -= 1; count += 1; }
      }
      if (count) branches.push({ x, direction, drills: count });
    }
  }
  const rate1 = drillRate(drill, item);
  for (const branch of branches) {
    const rows = Math.ceil(branch.drills / 2) * s;
    const belt = frame.belt(branch.drills * rate1);
    for (let row = 0; row < rows; row += 1) {
      const y = branch.direction === 1 ? yt + 1 + row : yt - 1 - row;
      board.place(belt, branch.x, y, branch.direction === 1 ? 3 : 1, null, { role: 'branch', lane: true });
    }
  }
  const total = drills.length * rate1;
  const belt = frame.belt(total);
  const westMost = Math.min(...branchColumns);
  const routerId = frame.profile.router;
  const escortRouterX = escort ? xEnd - escortCols + 1 + Math.floor((escortCols - 1) / 2) : null;
  for (let x = westMost; x <= xEnd; x += 1) {
    if (escort && x === escortRouterX) board.place(routerId, x, yt, 0, null, { role: 'router' });
    else board.place(belt, x, yt, 0, null, { role: 'trunk', lane: true });
  }
  const turrets = [];
  if (escort) {
    for (const startY of [yt + 1, yt - escortCols]) {
      const turret = board.placeAtStart(escort, xEnd - escortCols + 1, startY, 0, null, { role: 'turret' });
      if (turret) turrets.push(turret);
    }
  }
  return { drills, turrets, rate: total, belt, trunkRows: [yt] };
}

/** Style C: two collector belts sharing a middle row of drills: the densest layout for one core face. */
function buildDouble(frame, drill, item, plan) {
  const board = frame.board;
  const s = blockSize(drill);
  const core = frame.coreRect;
  const xEnd = core.startX - 1;
  const mid = core.startY + Math.floor((core.size - 1) / 2);
  const gapRows = s + 1;
  const y1 = mid - Math.ceil(gapRows / 2) + (gapRows % 2 === 0 ? 0 : 0);
  const y2 = y1 + gapRows;
  const availableColumns = Math.floor((xEnd + 1 - frame.soft.minX) / s);
  const wanted = Math.min(plan.maxDrills, 3 * availableColumns);
  const columns = Math.max(1, Math.ceil(wanted / 3));
  const drills = [];
  const trunkStart = xEnd - columns * s;
  for (let column = 0; column < columns; column += 1) {
    const startX = xEnd - s * (column + 1);
    if (startX < frame.soft.minX) break;
    const rows = [[y2 + 1, 1], [y1 + 1, null], [y1 - s, 3]];
    for (const [startY, away] of rows) {
      if (drills.length >= wanted) break;
      const tile = board.placeAtStart(drill, startX, startY, rotationFor(drill, away ?? 1), null, { role: 'drill' });
      if (tile) drills.push(tile);
    }
  }
  const rate1 = drillRate(drill, item);
  const per = Math.ceil(drills.length / 2) * rate1;
  const belt = frame.belt(per);
  const westMost = Math.max(frame.soft.minX, trunkStart);
  for (const y of [y1, y2]) {
    for (let x = westMost; x < xEnd; x += 1) board.place(belt, x, y, 0, null, { role: 'trunk', lane: true });
  }
  // Connectors: each trunk finishes in the core face (rows of the middle part of the face when they exist).
  const faceRows = [];
  for (let y = core.startY; y <= core.endY; y += 1) faceRows.push(y);
  const pickFace = y => faceRows.reduce((best, row) => (Math.abs(row - y) < Math.abs(best - y) ? row : best), faceRows[0]);
  const used = new Set();
  const trunkRows = [];
  for (const y of [y1, y2]) {
    let face = pickFace(y);
    if (used.has(face)) face = faceRows.find(row => !used.has(row)) ?? face;
    used.add(face);
    frame.connect({ start: { x: xEnd, y }, end: { x: xEnd, y: face }, endRotation: 0, rate: per, label: 'выход добычи' });
    trunkRows.push(y);
  }
  return { drills, turrets: [], rate: drills.length * rate1, belt, trunkRows };
}

export function buildMining(frame) {
  const settings = frame.settings;
  const raws = rawItems(frame.planet);
  const item = raws.includes(settings.goal) ? settings.goal : raws[0];
  frame.placeCore({ marginEast: 2 });
  const drill = chooseDrill(frame, item);
  if (!drill) {
    frame.fail(`Для «${itemName(item)}» нет подходящего бура на этой планете.`);
    return { goalId: item, item, label: itemName(item) };
  }
  const powered = describeBlock(drill).powerUse > 0;
  const rate1 = drillRate(drill, item);
  const capacity = laneCapacity(frame);
  const area = frame.width * frame.height;
  const fill = 0.55 + 0.45 * ((settings.compactness ?? 68) - 25) / 65;
  let maxDrills = Math.max(2, Math.min(Math.floor(capacity / rate1), Math.floor(area / (blockSize(drill) ** 2 * 5) * fill)));
  if (frame.variant === 2) maxDrills = Math.min(maxDrills * 2, Math.floor(capacity * 2 / rate1));
  if (powered && settings.includePower) {
    const per = describeBlock(drill).powerUse;
    const supply = plantBudget(frame);
    maxDrills = supply > 0 ? Math.max(2, Math.min(maxDrills, Math.floor(supply / per))) : maxDrills;
  }
  let escort = null;
  if (settings.includeDefense) {
    escort = turretsAccepting(frame, item, { maxSize: 3 })[0] ?? null;
    if (!escort) frame.note(`Защита: «${itemName(item)}» не подходит как боеприпас — турели лучше питать от ядра (направление «Оборона»).`);
  }
  const needsLiquid = Object.keys(describeBlock(drill).liquidsRequired).length > 0;
  // Beam/wall drills are powered one by one through nodes in line with them, so every drill needs a free face.
  const lineDrills = powered && frame.planet === 'erekir';
  const styles = lineDrills
    ? [buildTrunk, (...args) => buildComb(args[0], args[1], args[2], { ...args[3], gap: 1 }), (...args) => buildTrunk(args[0], args[1], args[2], { ...args[3], oneSided: true })]
    : [buildTrunk, buildComb, buildDouble];
  const style = needsLiquid ? buildTrunk : styles[frame.variant % styles.length];
  const result = style(frame, drill, item, { maxDrills, escort, oneSided: needsLiquid ? false : undefined });
  const board = frame.board;
  if (powered) {
    const nodeId = frame.pick(frame.profile.node);
    if (settings.includePower) {
      const demand = powerDemand(board.tiles);
      const anchor = { x: Math.floor((frame.soft.minX + xEndOf(frame)) / 2), y: board.bounds() ? board.bounds().endY + 3 : frame.soft.maxY };
      addPlant(frame, demand, anchor);
    }
    connectPower(frame, { nodeId });
    if (!settings.includePower) { addExternalPort(frame, { nodeId }); frame.require(`Подключи внешнее питание: до ${Math.round(powerDemand(board.tiles))} ед./с.`); }
    writeNodeLinks(frame);
  }
  if (settings.includeStorage) addStorage(frame);
  frame.note(`Добыча: ${result.drills.length} × ${blockName(drill)} → ≈${result.rate.toFixed(2)} «${itemName(item)}»/с по полному покрытию рудой (${(result.rate * 60).toFixed(0)}/мин).`);
  frame.note('Поставь схему так, чтобы буры стояли на руде (для лучевых буров — стена с рудой впереди).');
  return { goalId: item, item, label: itemName(item), drill, ...result, facts: facts[drill] };
}
