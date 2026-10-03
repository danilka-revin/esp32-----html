import { DIRS, blockSize } from '../geometry.js';
import { itemConfig } from './frame.js';
import { drillSupply } from './supply.js';
import { findFreeRect } from './power.js';
import { itemName, rawItems } from './profile.js';

const key = cell => `${cell.x},${cell.y}`;

export const permutations = list => {
  if (list.length <= 1) return [list];
  const seen = new Set();
  const result = [];
  for (const [index, item] of list.entries()) {
    for (const rest of permutations([...list.slice(0, index), ...list.slice(index + 1)])) {
      const candidate = [item, ...rest];
      const signature = candidate.join('|');
      if (!seen.has(signature)) { seen.add(signature); result.push(candidate); }
    }
  }
  return result;
};

/**
 * Standalone container above/below the machines with directional unloaders on the face towards them.
 * Used on Erekir (the core cannot be unloaded) and for non-minable ingredients in the Serpulo "local" mode.
 */
export function sideHub(frame, items, north) {
  const board = frame.board;
  const erekir = frame.planet === 'erekir';
  const id = erekir ? (items.length > 2 ? 'reinforced-vault' : 'reinforced-container') : (items.length > 2 ? 'vault' : 'container');
  const hubId = frame.has(id) ? id : (erekir ? 'reinforced-container' : 'container');
  const size = blockSize(hubId);
  const core = frame.coreRect;
  const yc = core.startY + Math.floor((core.size - 1) / 2);
  const anchor = { x: core.startX - 8, y: north ? yc + core.size + 6 : yc - core.size - 6 };
  const spot = findFreeRect(board, size + 2, size + 2, anchor, { margin: 3, region: frame.soft })
    ?? findFreeRect(board, size + 2, size + 2, anchor, { margin: 2, region: frame.soft })
    ?? findFreeRect(board, size + 2, size + 2, anchor, { margin: 1 });
  if (!spot) return null;
  const startX = spot.startX + 1;
  const startY = spot.startY + 1;
  const hub = board.placeAtStart(hubId, startX, startY, 0, null, { role: 'hub' });
  if (!hub) return null;
  const faceY = north ? startY - 1 : startY + size;
  const rotation = north ? 3 : 1;
  const facing = Array.from({ length: size }, (_, index) => ({ x: startX + index, y: faceY, rotation, dir: rotation }));
  // When the facing side has too few cells, lateral faces take the remaining unloaders.
  const lateral = Array.from({ length: size }, (_, index) => [
    { x: startX - 1, y: north ? startY + index : startY + size - 1 - index, rotation: 2, dir: 2 },
    { x: startX + size, y: north ? startY + index : startY + size - 1 - index, rotation: 0, dir: 0 },
  ]).flat();
  const slots = [...facing, ...lateral].slice(0, items.length);
  const inletCell = { x: startX, y: north ? startY + size : startY - 1 };
  if (board.isFree(inletCell.x, inletCell.y)) {
    board.place(frame.belt(2), inletCell.x, inletCell.y, north ? 3 : 1, null, { role: 'inlet', lane: true });
    frame.inlet({ x: inletCell.x, y: inletCell.y, kind: 'item', id: null });
  }
  frame.require(`Наполни контейнер: ${[...new Set(items)].map(item => `«${itemName(item)}»`).join(', ')} (вход — лента у контейнера).`);
  return { hub, slots };
}

/**
 * Where the unloaders of one side go: slots on a core face (Serpulo core mode) or on a hub face. Slots are only
 * computed here; the unloaders are placed per trial so that item-to-slot assignments can be searched.
 * `jobItems` has one entry per lane, so the same item may appear several times.
 */
function planSlots(frame, jobItems, north, forceHub = false) {
  const mode = frame.settings.supplyMode;
  const erekir = frame.planet === 'erekir';
  const unique = [...new Set(jobItems)];
  const rawLocal = item => mode === 'local' && !erekir && !forceHub && rawItems(frame.planet).includes(item);
  const hubItems = jobItems.filter(item => erekir || (mode === 'local' && !rawLocal(item)));
  const plan = { slots: [], fixed: new Map(), slotItems: [] };
  if (hubItems.length) {
    const hub = sideHub(frame, hubItems, north);
    for (const slot of hub?.slots ?? []) plan.slots.push(slot);
  }
  const coreItems = jobItems.filter(item => !hubItems.includes(item) && !rawLocal(item));
  if (coreItems.length) {
    // Own face first (eastmost cells first), then the opposite face when a small core runs out of cells.
    const own = frame.coreFace(north ? 1 : 3).sort((a, b) => b.x - a.x).map(cell => ({ x: cell.x, y: cell.y, rotation: 0, dir: north ? 1 : 3 }));
    const other = frame.coreFace(north ? 3 : 1).sort((a, b) => b.x - a.x).map(cell => ({ x: cell.x, y: cell.y, rotation: 0, dir: north ? 3 : 1 }));
    plan.slots.push(...[...own, ...other].slice(0, coreItems.length));
  }
  unique.filter(rawLocal).forEach((item, index) => {
    // Drill blocks of one side are stacked with room between them for their lanes to leave.
    const shift = index * 9;
    const supply = drillSupply(frame, item, { anchor: { x: frame.soft.minX + 1, y: north ? frame.soft.maxY - 1 - shift : frame.soft.minY + 1 + shift } });
    if (supply) plan.fixed.set(item, supply);
  });
  return plan;
}

/**
 * Route one dedicated lane per job (`{ item, north, port: {x, y, rotation}, rate }`) from supplies to ports.
 * Unloader cells and routing order are searched on throw-away copies of the board, so the committed result is
 * the first assignment in which every lane fits. Returns the number of sides that could not be completed.
 */
export function routeLanes(frame, jobs) {
  let failed = 0;
  // Keep both core faces free of passing lanes: they are where the unloaders go.
  const faceCells = [...frame.coreFace(1), ...frame.coreFace(3)];
  frame.board.reserve(faceCells, 'core-face');
  for (const north of [true, false]) {
    const sideJobs = jobs.filter(job => job.north === north);
    if (!sideJobs.length) continue;
    const attemptSide = (target, forceHub) => {
      const jobItems = sideJobs.map(job => job.item);
      const plan = planSlots(target, jobItems, north, forceHub);
      const slotJobs = sideJobs.filter(job => !plan.fixed.has(job.item));
      const slotItems = slotJobs.map(job => job.item);
      const attempts = [];
      for (const assignment of permutations(slotItems).slice(0, 24)) {
        const byDistance = [...slotJobs].sort((a, b) => a.port.x - b.port.x);
        const orders = [byDistance, [...byDistance].reverse()];
        if (slotJobs.length <= 3) for (const order of permutations(slotJobs.map((_, index) => index)).map(indexes => indexes.map(index => slotJobs[index]))) orders.push(order);
        for (const order of orders) attempts.push({ assignment, order });
      }
      const run = (frameLike, attempt) => {
        const targetBoard = frameLike.board;
        const startsByJob = new Map();
        // Assign slots to jobs in the order of `assignment` (item names); duplicates take slots in job order.
        const pool = slotJobs.map(job => job);
        attempt.assignment.forEach((item, index) => {
          const slot = plan.slots[index];
          const job = pool.find(candidate => candidate.item === item);
          if (!slot || !job) return;
          pool.splice(pool.indexOf(job), 1);
          const tile = targetBoard.place(frame.profile.unloader, slot.x, slot.y, slot.rotation, itemConfig(item), { role: 'unloader', item, ignoreReservation: true });
          if (tile) startsByJob.set(job, { item, tile, start: { x: slot.x + DIRS[slot.dir].x, y: slot.y + DIRS[slot.dir].y, dir: slot.dir } });
        });
        for (const job of sideJobs) if (plan.fixed.has(job.item)) startsByJob.set(job, plan.fixed.get(job.item));
        const ends = [];
        for (const job of sideJobs) {
          const start = startsByJob.get(job)?.start;
          job.ends = [{ x: job.port.x, y: job.port.y }, { x: job.port.x - DIRS[job.port.rotation].x, y: job.port.y - DIRS[job.port.rotation].y }];
          if (start) job.ends.push({ x: start.x, y: start.y }, { x: start.x + DIRS[start.dir ?? 0].x, y: start.y + DIRS[start.dir ?? 0].y });
          ends.push(...job.ends);
        }
        targetBoard.reserve(ends.filter(cell => targetBoard.isFree(cell.x, cell.y)), 'lane-end');
        let ok = true;
        const ordered = [...sideJobs.filter(job => plan.fixed.has(job.item)), ...attempt.order];
        for (const job of ordered) {
          const start = startsByJob.get(job)?.start;
          if (!start) { ok = false; break; }
          const placed = frameLike.connect({ start, end: { x: job.port.x, y: job.port.y }, endRotation: job.port.rotation, rate: job.rate, label: `вход «${itemName(job.item)}»`, allow: job.ends });
          if (!placed) { ok = false; break; }
        }
        targetBoard.releaseReservation(ends);
        return ok;
      };
      let chosen = null;
      for (const attempt of attempts.length ? attempts : [{ assignment: [], order: [] }]) {
        if (run(target.fork(), attempt)) { chosen = attempt; break; }
      }
      if (!chosen) { run(target, attempts[0] ?? { assignment: [], order: [] }); return false; }
      run(target, chosen);
      return true;
    };
    let done = false;
    const local = frame.settings.supplyMode === 'local';
    for (const forceHub of local ? [false, true] : [false]) {
      if (attemptSide(frame.fork(), forceHub)) { attemptSide(frame, forceHub); done = true; break; }
    }
    if (!done) { attemptSide(frame, local); failed += 1; frame.fail('Не удалось провести все входные линии без пересечений.'); }
  }
  frame.board.releaseReservation(faceCells);
  return failed;
}

export { key };
