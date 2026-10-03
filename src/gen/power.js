import { describeBlock, powerComponents, powerNodeLinks, generatorInfo } from '../flow.js';
import { DIRS, cellKey, distanceToRect, footprint, rectCenter, rectCells, ringCells, blockSize } from '../geometry.js';
import { availableOn, blockName, techTier } from './profile.js';

const isPowerRelevant = tile => {
  const info = describeBlock(tile.id);
  return info.powerUse > 0 || info.powerMake > 0;
};

export function powerDemand(tiles) {
  return tiles.reduce((sum, tile) => {
    const info = describeBlock(tile.id);
    return sum + (info.kind === 'battery' || info.kind === 'beam' ? 0 : info.powerUse);
  }, 0);
}

export function powerSupply(tiles) {
  return tiles.reduce((sum, tile) => sum + describeBlock(tile.id).powerMake, 0);
}

function relevantComponents(tiles) {
  return powerComponents(tiles).filter(component => component.some(isPowerRelevant));
}

const powerLinkable = info => info.outputsPower || info.consumesPower || info.kind === 'node';

/**
 * Tiles a node standing on `cell` would connect to: neighbours by proximity plus laser targets
 * (circle of `range` for power nodes, first powered block per cardinal line for beam nodes).
 */
function nodeReach(board, nodeId, cell, range) {
  const info = describeBlock(nodeId);
  const hits = new Set();
  const rect = footprint({ id: nodeId, x: cell.x, y: cell.y });
  for (const ring of ringCells(rect)) {
    const tile = board.tileAt(ring.x, ring.y);
    if (tile && describeBlock(tile.id).hasPower) hits.add(tile);
  }
  if (info.kind === 'beam') {
    DIRS.forEach((dir) => {
      for (let step = 1; step <= range; step += 1) {
        const tile = board.tileAt(cell.x + dir.x * step, cell.y + dir.y * step);
        if (tile && describeBlock(tile.id).hasPower) { hits.add(tile); break; }
      }
    });
  } else {
    const center = rectCenter(rect);
    for (const tile of board.tiles) {
      const other = describeBlock(tile.id);
      if (!other.hasPower || !powerLinkable(other)) continue;
      if (distanceToRect(center.x, center.y, footprint(tile)) <= range) hits.add(tile);
    }
  }
  return hits;
}

/** Can a node on `from` be linked to a node on `to`? Power nodes use a circle, beam nodes need a clear cardinal line. */
function nodesLinkable(board, nodeId, from, to, range) {
  const info = describeBlock(nodeId);
  if (info.kind === 'beam') {
    if (from.x !== to.x && from.y !== to.y) return false;
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    if (distance > range) return false;
    for (let step = 1; step < distance; step += 1) {
      const tile = board.tileAt(from.x + dx * step, from.y + dy * step);
      if (tile && describeBlock(tile.id).hasPower) return false;
    }
    return true;
  }
  return distanceToRect(from.x, from.y, footprint({ id: nodeId, x: to.x, y: to.y })) <= range;
}

/**
 * Shortest chain of nodes that connects `source` (a component) to `target` (another). Dijkstra over free cells:
 * a cell is a start if a node there reaches the source, a goal if it reaches the target.
 */
function nodeChain(board, nodeId, range, source, target, free) {
  const reachCache = new Map();
  const reach = cell => {
    const key = cellKey(cell.x, cell.y);
    if (!reachCache.has(key)) reachCache.set(key, nodeReach(board, nodeId, cell, range));
    return reachCache.get(key);
  };
  const sourceSet = new Set(source);
  const targetSet = new Set(target);
  const dist = new Map();
  const parent = new Map();
  const queue = [];
  for (const cell of free) {
    if ([...reach(cell)].some(tile => sourceSet.has(tile))) {
      dist.set(cellKey(cell.x, cell.y), 1);
      queue.push({ cell, cost: 1 });
    }
  }
  const info = describeBlock(nodeId);
  const neighborsOf = cell => (info.kind === 'beam'
    ? DIRS.flatMap(dir => Array.from({ length: range }, (_, index) => ({ x: cell.x + dir.x * (index + 1), y: cell.y + dir.y * (index + 1) })))
    : free.filter(other => Math.abs(other.x - cell.x) <= range + 1 && Math.abs(other.y - cell.y) <= range + 1));
  const freeSet = new Set(free.map(cell => cellKey(cell.x, cell.y)));
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const { cell, cost } = queue.shift();
    if (cost > (dist.get(cellKey(cell.x, cell.y)) ?? Infinity)) continue;
    if ([...reach(cell)].some(tile => targetSet.has(tile))) {
      const chain = [];
      let cursor = cellKey(cell.x, cell.y);
      while (cursor) { chain.push(cursor.split(',').map(Number)); cursor = parent.get(cursor); }
      return chain.reverse().map(([x, y]) => ({ x, y }));
    }
    for (const next of neighborsOf(cell)) {
      const key = cellKey(next.x, next.y);
      if (!freeSet.has(key) || (next.x === cell.x && next.y === cell.y)) continue;
      if (!nodesLinkable(board, nodeId, cell, next, range)) continue;
      const nextCost = cost + 1 + 0.01 * (Math.abs(next.x - cell.x) + Math.abs(next.y - cell.y));
      if (nextCost >= (dist.get(key) ?? Infinity)) continue;
      dist.set(key, nextCost);
      parent.set(key, cellKey(cell.x, cell.y));
      queue.push({ cell: next, cost: nextCost });
    }
  }
  return null;
}

/**
 * Join every powered block into one network with as few power nodes as possible.
 * Returns the number of nodes placed. Explicit links are written to node configs afterwards.
 */
export function connectPower(frame, { nodeId }) {
  const board = frame.board;
  if (!nodeId || !availableOn(nodeId, frame.planet)) return 0;
  const nodeInfo = describeBlock(nodeId);
  const range = nodeInfo.kind === 'beam' ? nodeInfo.beamRange : nodeInfo.laserRange;
  let placed = 0;
  for (let guard = 0; guard < 30; guard += 1) {
    const components = relevantComponents(board.tiles);
    if (components.length <= 1) break;
    const rank = component => powerSupply(component) * 1000 + component.length;
    const main = components.reduce((best, component) => (rank(component) > rank(best) ? component : best), components[0]);
    const mainRects = main.map(footprint);
    const others = components.filter(component => component !== main)
      .sort((a, b) => Math.min(...a.map(tile => Math.min(...mainRects.map(rect => distanceToRect(tile.x, tile.y, rect)))))
        - Math.min(...b.map(tile => Math.min(...mainRects.map(rect => distanceToRect(tile.x, tile.y, rect))))));
    const free = [];
    for (let y = 0; y < board.height; y += 1) {
      for (let x = 0; x < board.width; x += 1) if (board.isFree(x, y) && !board.reserved.has(cellKey(x, y))) free.push({ x, y });
    }
    let chain = null;
    for (const other of others) {
      chain = nodeChain(board, nodeId, range, other, main, free);
      if (chain) break;
    }
    if (!chain) { frame.fail('Не удалось соединить все блоки с энергосетью: не нашлось места для силового узла.'); break; }
    for (const cell of chain) { if (board.place(nodeId, cell.x, cell.y, 0, null, { role: 'power-node' })) placed += 1; }
  }
  return placed;
}

/** Make sure every network without a generator marks an obvious place to plug in external power. */
export function addExternalPort(frame, { nodeId }) {
  const board = frame.board;
  const components = relevantComponents(board.tiles);
  const needy = components.filter(component => powerSupply(component) <= 0 && powerDemand(component) > 0);
  let placed = 0;
  for (const component of needy) {
    const existing = component.find(tile => ['node', 'beam'].includes(describeBlock(tile.id).kind));
    if (existing) { frame.inlet({ x: existing.x, y: existing.y, kind: 'power' }); continue; }
    const rects = component.map(footprint);
    let spot = null;
    for (const rect of rects) {
      for (let y = rect.startY - 1; y <= rect.endY + 1 && !spot; y += 1) {
        for (let x = rect.startX - 1; x <= rect.endX + 1 && !spot; x += 1) {
          if (board.isFree(x, y) && !board.reserved.has(cellKey(x, y))) spot = { x, y };
        }
      }
      if (spot) break;
    }
    if (spot) {
      board.place(nodeId, spot.x, spot.y, 0, null, { role: 'power-node' });
      frame.inlet({ x: spot.x, y: spot.y, kind: 'power' });
      placed += 1;
    }
  }
  return placed;
}

/** Write each node's laser links explicitly, so the pasted blueprint wires itself exactly as planned. */
export function writeNodeLinks(frame) {
  const board = frame.board;
  const links = powerNodeLinks(board.tiles);
  for (const { node, targets } of links) {
    if (describeBlock(node.id).kind !== 'node') continue;
    const tile = board.tiles.find(candidate => candidate.x === node.x && candidate.y === node.y && candidate.id === node.id);
    if (tile && targets.length) tile.config = { type: 'point2[]', points: targets.map(target => ({ x: target.x - node.x, y: target.y - node.y })) };
  }
}

/** Find a free `width x height` rectangle closest to `anchor`; `margin` cells around it must hold no blocks. */
export function findFreeRect(board, width, height, anchor, { margin = 0, avoid = [], region = null } = {}) {
  let best = null;
  const blocked = new Set(avoid.map(cell => cellKey(cell.x, cell.y)));
  const minX = region ? Math.max(0, region.minX) : 0;
  const minY = region ? Math.max(0, region.minY) : 0;
  const maxX = region ? Math.min(board.width - 1, region.maxX) : board.width - 1;
  const maxY = region ? Math.min(board.height - 1, region.maxY) : board.height - 1;
  for (let y = minY; y + height - 1 <= maxY; y += 1) {
    for (let x = minX; x + width - 1 <= maxX; x += 1) {
      let ok = true;
      for (let dy = -margin; dy < height + margin && ok; dy += 1) {
        for (let dx = -margin; dx < width + margin && ok; dx += 1) {
          const cx = x + dx;
          const cy = y + dy;
          const inside = dx >= 0 && dy >= 0 && dx < width && dy < height;
          if (!board.cellInBounds(cx, cy)) continue;
          const key = cellKey(cx, cy);
          if (board.cells.has(key)) ok = false;
          else if (inside && (board.reserved.has(key) || blocked.has(key))) ok = false;
        }
      }
      if (!ok) continue;
      const distance = Math.hypot(x + width / 2 - anchor.x, y + height / 2 - anchor.y);
      if (!best || distance < best.distance) best = { startX: x, startY: y, distance };
    }
  }
  return best;
}

/** Solar-style generation: panels placed as a solid block, adjacent panels share one network. */
function addSolarField(frame, demand, anchor, { reserveRatio = 1.1 } = {}) {
  const board = frame.board;
  const candidates = ['solar-panel-large', 'solar-panel'].filter(id => availableOn(id, frame.planet));
  // Prefer the biggest panel the stage can afford, then fall back to the small one.
  const over = id => Math.max(0, techTier(id, frame.planet) - frame.tier);
  const ordered = candidates.sort((a, b) => over(a) - over(b) || blockSize(b) - blockSize(a));
  for (const id of ordered) {
    const size = blockSize(id);
    const perPanel = generatorInfo(id).power;
    const count = Math.max(1, Math.ceil(demand * reserveRatio / perPanel));
    if (count > 64) continue;
    // Arrange panels in near-square blocks; try wider shapes when the square does not fit.
    const shapes = [];
    for (let columns = Math.ceil(Math.sqrt(count)); columns <= count; columns += 1) shapes.push({ columns, rows: Math.ceil(count / columns) });
    // A field that only half fits would leave the blueprint short of power, so every shape and spot is tried
    // until one takes the whole count; only the fullest attempt is kept when none does.
    let best = null;
    for (const shape of shapes.slice(0, 5)) {
      const spots = [
        findFreeRect(board, shape.columns * size, shape.rows * size, anchor, { margin: 1, region: frame.soft }),
        findFreeRect(board, shape.columns * size, shape.rows * size, anchor, { margin: 0, region: frame.soft }),
        findFreeRect(board, shape.columns * size, shape.rows * size, anchor, { margin: 0 }),
      ].filter(Boolean);
      for (const spot of spots) {
        const tiles = [];
        for (let index = 0; index < count; index += 1) {
          const column = index % shape.columns;
          const row = Math.floor(index / shape.columns);
          const tile = board.placeAtStart(id, spot.startX + column * size, spot.startY + row * size, 0, null, { role: 'generator' });
          if (tile) tiles.push(tile);
        }
        if (tiles.length >= count) {
          frame.note(`Энергия: ${tiles.length} × ${blockName(id)} дают около ${Math.round(tiles.length * perPanel)} ед./с.`);
          return { id, count: tiles.length, supply: tiles.length * perPanel };
        }
        if (!best || tiles.length > best.tiles.length) best = { id, tiles, perPanel };
        for (const tile of tiles) board.remove(tile);
      }
    }
    if (best?.tiles.length) {
      const tiles = best.tiles.map(tile => board.placeAtStart(best.id, footprint(tile).startX, footprint(tile).startY, 0, null, { role: 'generator' })).filter(Boolean);
      frame.note(`Энергия: ${tiles.length} × ${blockName(best.id)} дают около ${Math.round(tiles.length * best.perPanel)} ед./с — этого меньше запроса (${Math.round(demand)} ед./с), добавь генераторы.`);
      return { id: best.id, count: tiles.length, supply: tiles.length * best.perPanel };
    }
  }
  return null;
}

export { DIRS, rectCells };


/** Erekir has no solar: steam-vent condensers are the only generator that needs no fuel or liquid feed. */
function addCondensers(frame, demand, anchor) {
  const id = 'turbine-condenser';
  if (!availableOn(id, frame.planet)) return null;
  const board = frame.board;
  const size = blockSize(id);
  const perUnit = generatorInfo(id).power * size * size;
  const count = Math.min(16, Math.max(1, Math.ceil(demand / perUnit)));
  // Same rule as the solar field: a row that only half fits leaves the station short, so every shape is tried.
  let best = null;
  for (let columns = count; columns >= 1; columns -= 1) {
    const rows = Math.ceil(count / columns);
    const spot = findFreeRect(board, columns * size, rows * size, anchor, { margin: 1, region: frame.soft })
      ?? findFreeRect(board, columns * size, rows * size, anchor, { margin: 0, region: frame.soft })
      ?? findFreeRect(board, columns * size, rows * size, anchor, { margin: 0 });
    if (!spot) continue;
    const tiles = [];
    for (let index = 0; index < count; index += 1) {
      const tile = board.placeAtStart(id, spot.startX + (index % columns) * size, spot.startY + Math.floor(index / columns) * size, 0, null, { role: 'generator' });
      if (tile) tiles.push(tile);
    }
    if (tiles.length >= count) {
      frame.note(`Энергия: ${tiles.length} × ${blockName(id)} около ${Math.round(tiles.length * perUnit)} ед./с — ставь их на паровые жерла (ячейка 3×3 целиком на жерле).`);
      return { id, count: tiles.length, supply: tiles.length * perUnit };
    }
    if (!best || tiles.length > best.tiles.length) best = { tiles };
    for (const tile of tiles) board.remove(tile);
  }
  if (!best?.tiles.length) return null;
  const tiles = best.tiles.map(tile => board.placeAtStart(id, footprint(tile).startX, footprint(tile).startY, 0, null, { role: 'generator' })).filter(Boolean);
  frame.note(`Энергия: ${tiles.length} × ${blockName(id)} около ${Math.round(tiles.length * perUnit)} ед./с — это меньше запроса (${Math.round(demand)} ед./с), добавь генераторы. Ставь их на паровые жерла (ячейка 3×3 целиком на жерле).`);
  return { id, count: tiles.length, supply: tiles.length * perUnit };
}

/** Add enough fuel-free generation for `demand` near `anchor`. Returns null when nothing fits. */
export function addPlant(frame, demand, anchor) {
  const result = frame.planet === 'erekir' ? addCondensers(frame, demand, anchor) : addSolarField(frame, demand, anchor);
  // A station that cannot cover the demand is not a silent failure: say how much is missing and how to fix it.
  if (!(demand > 0)) return result;
  if (!result || result.supply + 1e-9 < demand) {
    frame.require(`Генерации не хватает: нужно ≈${Math.round(demand)} ед./с, в схеме ≈${Math.round(result?.supply ?? 0)} ед./с. Увеличь холст, выключи «Питание» (тогда схема ждёт внешнюю сеть) или подключи её к силовому узлу.`);
  }
  return result;
}
