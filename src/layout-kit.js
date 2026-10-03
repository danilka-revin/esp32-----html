/**
 * Building blocks for the layout generator: an occupancy board, "hazard" zones around blocks that
 * dump items/liquids into anything adjacent, and a belt router that returns correctly rotated lanes.
 */
import { campaignBlockById, blockById } from './catalog.js';
import { describeBlock } from './flow.js';
import {
  DIRS, cellKey, footprint, originForStart, rectCells, rectsOverlap, ringCells, blockSize, opposite,
} from './geometry.js';

/** Min-heap keyed by priority; ties keep insertion order for deterministic routes. */
class Heap {
  constructor() { this.items = []; this.counter = 0; }
  get size() { return this.items.length; }
  push(priority, value) {
    this.items.push({ priority, order: this.counter += 1, value });
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.less(parent, index)) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }
  less(a, b) {
    const x = this.items[a];
    const y = this.items[b];
    return x.priority < y.priority || (x.priority === y.priority && x.order < y.order);
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.items.length && this.less(left, best)) best = left;
        if (right < this.items.length && this.less(right, best)) best = right;
        if (best === index) break;
        [this.items[best], this.items[index]] = [this.items[index], this.items[best]];
        index = best;
      }
    }
    return top.value;
  }
}

const liquidDumpers = new Set(['pump', 'liquidRouter']);

export class Board {
  constructor({ width = 64, height = 64, planet = 'serpulo' } = {}) {
    this.width = width;
    this.height = height;
    this.planet = planet;
    this.tiles = [];
    this.cells = new Map();
    this.itemHazard = new Map();
    this.liquidHazard = new Map();
    this.reserved = new Map();
    this.junctionAxes = new Map();
  }

  clone() {
    const copy = new Board({ width: this.width, height: this.height, planet: this.planet });
    copy.tiles = this.tiles.map(tile => ({ ...tile, meta: { ...tile.meta } }));
    copy.cells = new Map();
    const byOld = new Map(this.tiles.map((tile, index) => [tile, copy.tiles[index]]));
    for (const [key, tile] of this.cells) copy.cells.set(key, byOld.get(tile));
    const cloneHazards = source => new Map([...source].map(([key, owners]) => [key, new Set([...owners].map(owner => byOld.get(owner)))]));
    copy.itemHazard = cloneHazards(this.itemHazard);
    copy.liquidHazard = cloneHazards(this.liquidHazard);
    copy.reserved = new Map(this.reserved);
    copy.junctionAxes = new Map([...this.junctionAxes].map(([key, axes]) => [key, { ...axes }]));
    return copy;
  }

  inBounds(rect) {
    return rect.startX >= 0 && rect.startY >= 0 && rect.endX < this.width && rect.endY < this.height;
  }

  cellInBounds(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  tileAt(x, y) { return this.cells.get(cellKey(x, y)) ?? null; }
  isFree(x, y) { return this.cellInBounds(x, y) && !this.cells.has(cellKey(x, y)); }

  rectFree(rect, ignore = null) {
    if (!this.inBounds(rect)) return false;
    return rectCells(rect).every(cell => {
      const tile = this.cells.get(cellKey(cell.x, cell.y));
      return !tile || tile === ignore;
    });
  }

  canPlaceAt(id, x, y) { return this.rectFree(footprint({ id, x, y })); }

  /** Reserve cells so that routers and planners leave them alone (e.g. the footprint of a block placed later). */
  reserve(cells, owner = 'reserved') { for (const cell of cells) this.reserved.set(cellKey(cell.x, cell.y), owner); }
  releaseReservation(cells) { for (const cell of cells) this.reserved.delete(cellKey(cell.x, cell.y)); }

  place(id, x, y, rotation = 0, config = null, meta = {}) {
    if (!campaignBlockById.has(id)) throw new Error(`Блок «${id}» недоступен в кампании: его нельзя разместить в схеме.`);
    const rect = footprint({ id, x, y });
    if (!this.rectFree(rect)) return null;
    for (const cell of rectCells(rect)) {
      const owner = this.reserved.get(cellKey(cell.x, cell.y));
      if (owner && owner !== meta.owner && !meta.ignoreReservation) return null;
    }
    const tile = { id, x, y, rotation: ((rotation % 4) + 4) % 4, config, meta: { ...meta } };
    this.tiles.push(tile);
    for (const cell of rectCells(rect)) {
      this.cells.set(cellKey(cell.x, cell.y), tile);
      this.reserved.delete(cellKey(cell.x, cell.y));
    }
    this.registerHazards(tile);
    return tile;
  }

  /** Place by the lower-left corner of the footprint, which is how layouts are planned. */
  placeAtStart(id, startX, startY, rotation = 0, config = null, meta = {}) {
    const origin = originForStart(id, startX, startY);
    return this.place(id, origin.x, origin.y, rotation, config, meta);
  }

  remove(tile) {
    const index = this.tiles.indexOf(tile);
    if (index < 0) return;
    this.tiles.splice(index, 1);
    for (const cell of rectCells(footprint(tile))) this.cells.delete(cellKey(cell.x, cell.y));
    for (const map of [this.itemHazard, this.liquidHazard]) {
      for (const [key, owners] of map) {
        owners.delete(tile);
        if (!owners.size) map.delete(key);
      }
    }
  }

  registerHazards(tile) {
    const info = describeBlock(tile.id);
    const add = (map, owner) => {
      for (const cell of ringCells(footprint(owner))) {
        const key = cellKey(cell.x, cell.y);
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(owner);
      }
    };
    if (info.isDumper) add(this.itemHazard, tile);
    if (liquidDumpers.has(info.kind) || info.fact.outputLiquids || tile.id === 'oil-extractor') add(this.liquidHazard, tile);
  }

  rect(tile) { return footprint(tile); }

  /** Neighbour tiles (unique) around a tile. */
  neighbors(tile) {
    const seen = new Set();
    const result = [];
    for (const cell of ringCells(footprint(tile))) {
      const other = this.tileAt(cell.x, cell.y);
      if (other && other !== tile && !seen.has(other)) { seen.add(other); result.push({ tile: other, side: cell.side }); }
    }
    return result;
  }

  /** All free cells of a rectangle ring (used to pick port locations). */
  freeRing(tile) { return ringCells(footprint(tile)).filter(cell => this.isFree(cell.x, cell.y)); }

  bounds() {
    if (!this.tiles.length) return null;
    const rects = this.tiles.map(footprint);
    return {
      startX: Math.min(...rects.map(r => r.startX)), startY: Math.min(...rects.map(r => r.startY)),
      endX: Math.max(...rects.map(r => r.endX)), endY: Math.max(...rects.map(r => r.endY)),
    };
  }

  /** Clean tile list for the editor: no planner metadata. */
  toTiles() {
    return this.tiles.map(({ id, x, y, rotation, config }) => ({ id, x, y, rotation, config: config ?? null }));
  }

  /**
   * Find a path for a lane (conveyor, duct, conduit) from `start` (first lane cell) to `end` (last lane cell,
   * which must face `endRotation`). Lanes never run along hazard cells, never reverse into the source, and may
   * cross another lane of the same kind through a junction (`junction` id) when `cross` is set.
   *
   * `jumps` adds bridge and phase links: `[{ id, range, cost }]`. A jump leaves the lane at one cell and
   * reappears further along the same line, so a lane can fly over machines, walls and other lanes instead of
   * taking a long detour. The two ends of a jump are ordinary 1x1 blocks: the entry (which carries the link
   * for point-linked bridges) and the exit, which always faces the direction of the jump — so the lane has to
   * continue straight after landing, or end there.
   */
  route({
    start, end, endRotation, lane = 'conveyor', junction = null, hazard = 'item', allow = [], avoid = [],
    turnCost = 1.6, crossCost = 9, maxCells = 200, jumps = [],
  }) {
    const laneKind = describeBlock(lane).kind;
    const hazardMap = hazard === 'liquid' ? this.liquidHazard : this.itemHazard;
    const allowed = new Set([cellKey(start.x, start.y), cellKey(end.x, end.y), ...allow.map(cell => cellKey(cell.x, cell.y))]);
    // Cells next to a block that dumps into neighbours are off limits, except next to the lane's own source
    // (its start) and at the lane's final cell, where the lane meets its target.
    const endKey = cellKey(end.x, end.y);
    const sourceOwners = hazardMap.get(cellKey(start.x, start.y)) ?? new Set();
    const avoided = new Set(avoid.map(cell => cellKey(cell.x, cell.y)));
    const usable = (x, y) => {
      if (!this.cellInBounds(x, y)) return false;
      const key = cellKey(x, y);
      if (this.cells.has(key) || avoided.has(key)) return false;
      if (this.reserved.has(key) && !allowed.has(key)) return false;
      const owners = hazardMap.get(key);
      if (owners && key !== endKey && [...owners].some(owner => !sourceOwners.has(owner))) return false;
      return true;
    };
    const crossable = (x, y, dir) => {
      if (!junction) return false;
      const tile = this.tileAt(x, y);
      if (!tile || describeBlock(tile.id).kind !== laneKind || tile.rotation % 2 === dir % 2) return false;
      if (hazardMap.has(cellKey(x, y))) return false;
      // The crossed lane must keep flowing: a lane cell behind and an acceptor in front.
      const behind = this.tileAt(x - DIRS[tile.rotation].x, y - DIRS[tile.rotation].y);
      const ahead = this.tileAt(x + DIRS[tile.rotation].x, y + DIRS[tile.rotation].y);
      if (!behind || !ahead) return false;
      if (!(describeBlock(behind.id).kind === laneKind && behind.rotation === tile.rotation)) return false;
      return true;
    };
    /**
     * Can a lane stepping from `node` into `dir` instead jump? The entry sits on the next cell
     * (`entryX`, `entryY`); the exit lands `span` cells further along the same line. Both ends need a free
     * cell, the gap between them has to hold something worth jumping over, and the exit must be able to
     * keep going straight with empty flanks so it does not leak into unrelated neighbours.
     */
    const startKey = cellKey(start.x, start.y);
    const jumpList = jumps.filter(entry => entry && entry.id && entry.range >= 2);
    const tryJump = (entryX, entryY, dir) => {
      if (!jumpList.length) return null;
      const step = DIRS[dir];
      if (!usable(entryX, entryY)) return null;
      for (const jump of jumpList) {
        const linkKind = describeBlock(jump.id).kind;
        const rotationLinked = linkKind === 'ductBridge';
        for (let span = 2; span <= jump.range; span += 1) {
          const exit = { x: entryX + step.x * span, y: entryY + step.y * span };
          const isEnd = cellKey(exit.x, exit.y) === endKey;
          if (isEnd) { if (endRotation !== dir) break; }
          else if (!usable(exit.x + step.x, exit.y + step.y)) break;
          if (!usable(exit.x, exit.y)) continue;
          const sideA = { x: exit.x + DIRS[(dir + 1) % 4].x, y: exit.y + DIRS[(dir + 1) % 4].y };
          const sideB = { x: exit.x + DIRS[(dir + 3) % 4].x, y: exit.y + DIRS[(dir + 3) % 4].y };
          if (!this.isFree(sideA.x, sideA.y) || !this.isFree(sideB.x, sideB.y)) continue;
          let obstacle = false;
          let clean = true;
          for (let offset = 1; offset < span; offset += 1) {
            const cx = entryX + step.x * offset;
            const cy = entryY + step.y * offset;
            if (!usable(cx, cy)) obstacle = true;
            if (cellKey(cx, cy) === endKey) clean = false;
            const tile = this.tileAt(cx, cy);
            // A rotation-linked bridge links to the first of its own kind ahead of it: another one in the
            // gap would steal the link, and so would one right behind the exit.
            if (tile && (tile.id === jump.id || (rotationLinked && describeBlock(tile.id).kind === 'ductBridge'))) clean = false;
          }
          if (rotationLinked) {
            for (let offset = 1; offset <= 4; offset += 1) {
              const tile = this.tileAt(exit.x + step.x * offset, exit.y + step.y * offset);
              if (tile && describeBlock(tile.id).kind === 'ductBridge') { clean = false; break; }
            }
          }
          if (!obstacle || !clean) continue;
          return { entry: { x: entryX, y: entryY }, exit, jump, span };
        }
      }
      return null;
    };

    if (!usable(start.x, start.y) || !usable(end.x, end.y)) return null;

    const open = new Heap();
    const best = new Map();
    const parents = new Map();
    const stateKey = (x, y, dir) => `${x},${y},${dir}`;
    const heuristic = (x, y) => Math.abs(x - end.x) + Math.abs(y - end.y);
    const startState = stateKey(start.x, start.y, -1);
    best.set(startState, 0);
    open.push(heuristic(start.x, start.y), { x: start.x, y: start.y, dir: -1, cost: 0, crossed: false });
    let goal = null;
    while (open.size) {
      const node = open.pop();
      const key = stateKey(node.x, node.y, node.dir);
      if (node.cost > (best.get(key) ?? Infinity)) continue;
      if (node.x === end.x && node.y === end.y) { goal = node; break; }
      if (node.cost > maxCells * 3) continue;
      for (let dir = 0; dir < 4; dir += 1) {
        if (node.dir >= 0 && dir === opposite(node.dir)) continue;
        // A lane that arrived on a bridge exit faces that way and has to keep going the same way.
        if (node.lockDir != null && dir !== node.lockDir) continue;
        const nx = node.x + DIRS[dir].x;
        const ny = node.y + DIRS[dir].y;
        const turn = node.dir >= 0 && node.dir !== dir ? turnCost : 0;
        // Every direction offers up to three moves, and A* picks the cheapest: walk to the next cell, cross a
        // lane with junctions, or jump the gap with a bridge. The bridge entry goes on the next cell even when
        // that cell is free — the obstacle it flies over is further along the line.
        const moves = [];
        if (usable(nx, ny)) moves.push({ target: { x: nx, y: ny, crossings: [] }, extra: 0 });
        else if (junction) {
          // Cross one lane, or several lanes side by side, with a chain of junctions.
          const crossed = [];
          let cx = nx;
          let cy = ny;
          while (crossed.length < 4 && crossable(cx, cy, dir) && !this.junctionAxes.has(cellKey(cx, cy))) {
            crossed.push({ x: cx, y: cy, dir });
            cx += DIRS[dir].x;
            cy += DIRS[dir].y;
          }
          if (crossed.length && usable(cx, cy) && !(cx === end.x && cy === end.y && endRotation === opposite(dir))) {
            moves.push({ target: { x: cx, y: cy, crossings: crossed }, extra: crossCost * crossed.length });
          }
        }
        const jump = tryJump(nx, ny, dir);
        if (jump) moves.push({ target: { x: jump.exit.x, y: jump.exit.y, crossings: [], jump }, extra: jump.jump.cost + (jump.span - 2) * 0.05 });
        for (const move of moves) {
          const target = move.target;
          // The search knows (cell, direction) pairs, so it can walk back onto a cell it already used — a lane
          // that loops onto its own entrance. Nothing needs that, and a bridge placed on a cell the lane is
          // already standing on would lose half of its link.
          if (cellKey(target.x, target.y) === startKey) continue;
          const cost = node.cost + 1 + target.crossings.length + turn + move.extra;
          const nextKey = stateKey(target.x, target.y, dir);
          if (cost >= (best.get(nextKey) ?? Infinity)) continue;
          best.set(nextKey, cost);
          parents.set(nextKey, { from: key, crossings: target.crossings, jump: target.jump ?? null });
          open.push(cost + heuristic(target.x, target.y), { x: target.x, y: target.y, dir, cost, lockDir: target.jump ? dir : null });
        }
      }
    }
    if (!goal) return null;

    // Reconstruct cells and crossings.
    const states = [];
    let cursor = stateKey(goal.x, goal.y, goal.dir);
    while (cursor) {
      states.push(cursor);
      cursor = parents.get(cursor)?.from;
    }
    states.reverse();
    const cells = [];
    const crossings = [];
    for (let index = 0; index < states.length; index += 1) {
      const [x, y, dir] = states[index].split(',').map(Number);
      const parent = parents.get(states[index]);
      for (const cross of parent?.crossings ?? []) {
        crossings.push({ x: cross.x, y: cross.y });
        cells.push({ x: cross.x, y: cross.y, junction: true, dir });
      }
      if (parent?.jump) {
        // Both ends of the link: the entry keeps the relative offset to the exit, the exit just faces forward.
        const { entry, exit, jump } = parent.jump;
        cells.push({ x: entry.x, y: entry.y, bridge: 'entry', dir, jumpId: jump.id, dx: exit.x - entry.x, dy: exit.y - entry.y });
        cells.push({ x: exit.x, y: exit.y, bridge: 'exit', dir, jumpId: jump.id });
        crossings.push({ x: entry.x, y: entry.y });
      } else {
        cells.push({ x, y, junction: false, dir });
      }
    }
    if (cells.length > maxCells) return null;
    // Rotation of each plain cell points at the next cell (a junction counts as the next cell); the last cell faces the target.
    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index].junction || cells[index].bridge) continue;
      const next = cells[index + 1];
      if (!next) cells[index].rotation = endRotation;
      else cells[index].rotation = DIRS.findIndex(dir => cells[index].x + dir.x === next.x && cells[index].y + dir.y === next.y);
    }
    return { cells, crossings, cost: goal.cost, jumps: cells.filter(cell => cell.bridge === 'entry').length };
  }

  /** Place the lane returned by `route`. Crossed belts become junctions, jumps become linked bridge pairs. */
  commitRoute(path, { lane = 'conveyor', junction = 'junction', config = null, meta = {} } = {}) {
    const placed = [];
    for (const cell of path.cells) {
      if (cell.bridge) {
        const id = cell.jumpId ?? lane;
        const kind = describeBlock(id).kind;
        // A lane may cross its own earlier cells; the tile standing there is part of this very lane, so the
        // bridge takes the cell over instead of leaving an unlinked half-pair behind.
        const previous = this.tileAt(cell.x, cell.y);
        if (previous && ['belt', 'armored', 'stack', 'junction', 'router', 'gate'].includes(describeBlock(previous.id).kind)) this.remove(previous);
        // Point-linked bridges (`bridge-conveyor`, `phase-conveyor`, conduits) carry the offset to their exit;
        // rotation-linked ones (`duct-bridge`) find it by looking along their own facing.
        const link = cell.bridge === 'entry' && ['bridge', 'liquidBridge'].includes(kind)
          ? { type: 'point2', x: cell.dx, y: cell.dy }
          : null;
        placed.push(this.place(id, cell.x, cell.y, cell.dir, link, { ...meta, lane: true, jump: true, ignoreReservation: true }));
        continue;
      }
      if (cell.junction) {
        const old = this.tileAt(cell.x, cell.y);
        if (old && describeBlock(old.id).kind === describeBlock(lane).kind) this.remove(old);
        const tile = this.place(junction, cell.x, cell.y, 0, null, { ...meta, junction: true, ignoreReservation: true });
        if (tile) this.junctionAxes.set(cellKey(cell.x, cell.y), { h: true, v: true });
        placed.push(tile);
      } else {
        placed.push(this.place(lane, cell.x, cell.y, cell.rotation, config, { ...meta, lane: true, ignoreReservation: true }));
      }
    }
    return placed;
  }
}

export function sizeOf(id) { return blockSize(id); }
export function blockName(id) { return blockById.get(id)?.name ?? id; }
export { rectsOverlap };
