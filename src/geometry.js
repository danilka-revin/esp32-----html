import { blockById } from './catalog.js';

/** Rotation convention shared with Mindustry: 0 = east, 1 = north, 2 = west, 3 = south (y grows upward). */
export const DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
export const opposite = rotation => (rotation + 2) % 4;
export const cellKey = (x, y) => `${x},${y}`;
export const parseCell = key => key.split(',').map(Number);

/** Direction index for a unit step, or -1. */
export function dirIndex(dx, dy) {
  return DIRS.findIndex(dir => dir.x === Math.sign(dx) && dir.y === Math.sign(dy) && (dx === 0 || dy === 0));
}

/** Mindustry `Block.sizeOffset`: -((size - 1) / 2) with integer division. */
export function sizeOffset(size) { return Math.floor((size - 1) / 2); }

export function blockSize(id) { return blockById.get(id)?.size ?? 1; }

export function rectFromStart(startX, startY, size) {
  return { startX, startY, endX: startX + size - 1, endY: startY + size - 1, size };
}

export function footprint(tile) {
  const size = blockSize(tile.id);
  const offset = sizeOffset(size);
  return rectFromStart(tile.x - offset, tile.y - offset, size);
}

/** Origin tile for a block whose lower-left footprint corner is (startX, startY). */
export function originForStart(id, startX, startY) {
  const offset = sizeOffset(blockSize(id));
  return { x: startX + offset, y: startY + offset };
}

export function rectCells(rect) {
  const cells = [];
  for (let y = rect.startY; y <= rect.endY; y += 1) for (let x = rect.startX; x <= rect.endX; x += 1) cells.push({ x, y });
  return cells;
}

export function rectContains(rect, x, y) {
  return x >= rect.startX && x <= rect.endX && y >= rect.startY && y <= rect.endY;
}

export function rectsOverlap(a, b) {
  return a.startX <= b.endX && a.endX >= b.startX && a.startY <= b.endY && a.endY >= b.startY;
}

/** Cells edge-adjacent to the rectangle, in a stable clockwise order starting at the lower-left corner. */
export function ringCells(rect) {
  const cells = [];
  for (let x = rect.startX; x <= rect.endX; x += 1) cells.push({ x, y: rect.startY - 1, side: 3, toward: 1 });
  for (let y = rect.startY; y <= rect.endY; y += 1) cells.push({ x: rect.endX + 1, y, side: 0, toward: 2 });
  for (let x = rect.endX; x >= rect.startX; x -= 1) cells.push({ x, y: rect.endY + 1, side: 1, toward: 3 });
  for (let y = rect.endY; y >= rect.startY; y -= 1) cells.push({ x: rect.startX - 1, y, side: 2, toward: 0 });
  return cells;
}

/** Cells of one face: `side` is the direction pointing away from the block (0 east, 1 north, 2 west, 3 south). */
export function faceCells(rect, side) {
  return ringCells(rect).filter(cell => cell.side === side);
}

/** Distance (in tiles) from a point to the closest point of a rectangle, as Mindustry's laser-range test. */
export function distanceToRect(px, py, rect) {
  const dx = Math.max(rect.startX - 0.5 - px, 0, px - (rect.endX + 0.5));
  const dy = Math.max(rect.startY - 0.5 - py, 0, py - (rect.endY + 0.5));
  return Math.hypot(dx, dy);
}

export function rectCenter(rect) {
  return { x: (rect.startX + rect.endX) / 2, y: (rect.startY + rect.endY) / 2 };
}

export function boundsOf(tiles) {
  if (!tiles.length) return null;
  const rects = tiles.map(footprint);
  return {
    startX: Math.min(...rects.map(r => r.startX)), startY: Math.min(...rects.map(r => r.startY)),
    endX: Math.max(...rects.map(r => r.endX)), endY: Math.max(...rects.map(r => r.endY)),
  };
}
