import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/layout-kit.js';
import { DIRS, footprint } from '../src/geometry.js';

const follow = (board, path) => path.cells.map(cell => ({ ...cell, tile: board.tileAt(cell.x, cell.y) }));

test('routes are rotated along their path and the last cell faces the target', () => {
  const board = new Board({ width: 30, height: 30 });
  const machine = board.place('silicon-smelter', 20, 10);            // 20..21 x 10..11
  const path = board.route({ start: { x: 2, y: 3 }, end: { x: 19, y: 10 }, endRotation: 0, lane: 'conveyor', junction: 'junction' });
  assert.ok(path);
  board.commitRoute(path, { lane: 'conveyor', junction: 'junction' });
  const cells = path.cells;
  for (let index = 0; index < cells.length - 1; index += 1) {
    const tile = board.tileAt(cells[index].x, cells[index].y);
    const dir = DIRS[tile.rotation];
    assert.deepEqual([cells[index].x + dir.x, cells[index].y + dir.y], [cells[index + 1].x, cells[index + 1].y], 'each belt faces the next one');
  }
  const last = cells.at(-1);
  const lastTile = board.tileAt(last.x, last.y);
  assert.equal(lastTile.rotation, 0);
  assert.equal(board.tileAt(last.x + 1, last.y), machine, 'the final belt feeds the machine');
});

test('routes never run along the sides of a block that dumps items, except at the final cell', () => {
  const board = new Board({ width: 30, height: 30 });
  const machine = board.place('silicon-smelter', 15, 15);            // 15..16 x 15..16
  const path = board.route({ start: { x: 4, y: 15 }, end: { x: 15, y: 14 }, endRotation: 1, lane: 'conveyor' });
  assert.ok(path);
  const ring = new Set();
  const rect = footprint(machine);
  for (let x = rect.startX - 1; x <= rect.endX + 1; x += 1) for (let y = rect.startY - 1; y <= rect.endY + 1; y += 1) {
    const inside = x >= rect.startX && x <= rect.endX && y >= rect.startY && y <= rect.endY;
    const corner = (x < rect.startX || x > rect.endX) && (y < rect.startY || y > rect.endY);
    if (!inside && !corner) ring.add(`${x},${y}`);
  }
  const touching = path.cells.filter(cell => ring.has(`${cell.x},${cell.y}`));
  assert.deepEqual(touching.map(cell => `${cell.x},${cell.y}`), ['15,14'], 'only the port cell touches the machine');
});

test('crossing another lane uses junctions and keeps both lanes flowing', () => {
  const board = new Board({ width: 30, height: 30 });
  for (let x = 2; x <= 20; x += 1) board.place('conveyor', x, 10, 0);
  const target = board.place('container', 12, 3);                    // 12..13 x 3..4 below the lane
  const path = board.route({ start: { x: 12, y: 16 }, end: { x: 12, y: 5 }, endRotation: 3, lane: 'conveyor', junction: 'junction', crossCost: 1 });
  assert.ok(path, 'a route exists only by crossing the horizontal lane');
  board.commitRoute(path, { lane: 'conveyor', junction: 'junction' });
  assert.equal(board.tileAt(12, 10).id, 'junction');
  assert.equal(board.tileAt(11, 10).rotation, 0);
  assert.equal(board.tileAt(13, 10).rotation, 0);
  assert.equal(board.tileAt(12, 6).rotation, 3);
  assert.equal(board.tileAt(12, 5).rotation, 3);
  assert.equal(target, board.tileAt(12, 4));
});

test('without a junction a closed wall of lane blocks the route', () => {
  const board = new Board({ width: 20, height: 12 });
  for (let x = 0; x < 20; x += 1) board.place('conveyor', x, 6, 0);
  assert.equal(board.route({ start: { x: 5, y: 10 }, end: { x: 5, y: 2 }, endRotation: 3, lane: 'conveyor' }), null);
});

test('reserved cells and overlapping placements are refused', () => {
  const board = new Board({ width: 12, height: 12 });
  board.reserve([{ x: 5, y: 5 }], 'owner');
  assert.equal(board.place('conveyor', 5, 5, 0), null);
  assert.ok(board.place('conveyor', 5, 5, 0, null, { owner: 'owner' }));
  assert.equal(board.place('silicon-smelter', 4, 4), null, 'overlaps the belt');
  assert.throws(() => board.place('definitely-not-a-block', 0, 0), /недоступен/);
  assert.equal(board.place('conveyor', 99, 99), null, 'outside the board');
});

test('a cloned board is independent of the original', () => {
  const board = new Board({ width: 12, height: 12 });
  board.place('router', 3, 3);
  const copy = board.clone();
  copy.place('conveyor', 4, 3, 0);
  assert.equal(board.tileAt(4, 3), null);
  assert.equal(copy.tileAt(3, 3).id, 'router');
  assert.ok(copy.itemHazard.has('4,3') === false || copy.tileAt(4, 3));
});
