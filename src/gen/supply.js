import { blockSize, ringCells } from '../geometry.js';
import { itemConfig } from './frame.js';
import { findFreeRect } from './power.js';
import { chooseDrill } from './mining.js';
import { blockName, drillRate, itemName, rawItems } from './profile.js';

/** Serpulo: one unloader on the core's west face; its lane starts right behind it. */
function coreUnloader(frame, item, anchorY, taken = new Set()) {
  const board = frame.board;
  const cells = frame.coreFace(2).filter(cell => !taken.has(cell.y));
  if (!cells.length) return null;
  const slot = cells.find(cell => cell.y === anchorY) ?? cells.reduce((best, cell) => (Math.abs(cell.y - anchorY) < Math.abs(best.y - anchorY) ? cell : best), cells[0]);
  const tile = board.place(frame.profile.unloader, slot.x, slot.y, 0, itemConfig(item), { role: 'unloader', item });
  if (!tile) return null;
  taken.add(slot.y);
  return { item, tile, start: frame.laneStart(slot, 2) };
}

/**
 * Standalone storage that stands in for the core: Erekir cores cannot be unloaded, so a container (not touching the core)
 * feeds directional duct unloaders. Serpulo uses it for the "local" mode with an inlet for outside deliveries.
 */
export function bufferHub(frame, items, anchorY, { gap = 2 } = {}) {
  const board = frame.board;
  const erekir = frame.planet === 'erekir';
  const id = erekir ? (items.length > 2 ? 'reinforced-vault' : 'reinforced-container') : (items.length > 2 ? 'vault' : 'container');
  const fallback = erekir ? 'reinforced-container' : 'container';
  const hubId = frame.has(id) ? id : fallback;
  const size = blockSize(hubId);
  const core = frame.coreRect;
  const startX = core.startX - 1 - gap - size + 1;
  const startY = Math.max(0, Math.min(frame.board.height - size, anchorY - Math.floor((size - 1) / 2)));
  const hub = board.placeAtStart(hubId, startX, startY, 0, null, { role: 'hub' });
  if (!hub) return null;
  const west = ringCells({ startX, startY, endX: startX + size - 1, endY: startY + size - 1, size }).filter(cell => cell.side === 2);
  const starts = [];
  for (const [index, item] of items.slice(0, west.length).entries()) {
    const slot = west[index];
    const unloader = board.place(frame.profile.unloader, slot.x, slot.y, 2, itemConfig(item), { role: 'unloader', item });
    if (unloader) {
      const start = frame.laneStart(slot, 2);
      board.reserve([start, { x: start.x - 1, y: start.y }], 'lane-end');
      starts.push({ item, tile: unloader, start });
    }
  }
  // Inlet: a lane stub feeding the buffer from outside (north face).
  const north = ringCells({ startX, startY, endX: startX + size - 1, endY: startY + size - 1, size }).filter(cell => cell.side === 1);
  const inletCell = north.find(cell => board.isFree(cell.x, cell.y));
  if (inletCell) {
    const belt = frame.belt(2);
    const inlet = board.place(belt, inletCell.x, inletCell.y, 3, null, { role: 'inlet', lane: true });
    if (inlet) {
      frame.inlet({ x: inletCell.x, y: inletCell.y, kind: 'item', id: null });
      frame.require(`Подай в буфер ${items.map(itemName).map(name => `«${name}»`).join(', ')} по ленте у контейнера (${blockName(hubId)}).`);
    }
  }
  return { hub, starts, westEdge: starts.length ? Math.min(...starts.map(entry => entry.tile.x)) : startX - 1, width: size + gap };
}

/** Small block of drills ending in a belt: the local source for a raw item. */
export function drillSupply(frame, item, { count = 4, anchor = { x: frame.soft.minX + 1, y: frame.soft.maxY - 1 } } = {}) {
  const board = frame.board;
  const drill = chooseDrill(frame, item, { allowPower: false });
  if (!drill || !rawItems(frame.planet).includes(item)) return null;
  const powered = (describeBlockPower(drill)) > 0;
  if (powered) return null;
  const s = blockSize(drill);
  const pairs = Math.max(1, Math.ceil(count / 2));
  const length = pairs * s;
  const spot = findFreeRect(board, length + 3, 2 * s + 1, anchor, { margin: 1, region: frame.soft }) ?? findFreeRect(board, length + 3, 2 * s + 1, anchor, { margin: 0 });
  if (!spot) return null;
  const y = spot.startY + s;
  const rate = pairs * 2 * drillRate(drill, item);
  const belt = frame.belt(rate);
  for (let index = 0; index < length; index += 1) board.place(belt, spot.startX + index, y, 0, null, { role: 'trunk', lane: true });
  const drills = [];
  for (let pair = 0; pair < pairs; pair += 1) {
    for (const startY of [y + 1, y - s]) {
      const tile = board.placeAtStart(drill, spot.startX + pair * s, startY, 0, null, { role: 'drill' });
      if (tile) drills.push(tile);
    }
  }
  frame.note(`Локальная подача: ${drills.length} × ${blockName(drill)} добывают «${itemName(item)}» (≈${(drills.length * drillRate(drill, item)).toFixed(1)}/с).`);
  const start = { x: spot.startX + length, y, dir: 0 };
  // Keep the exit of the lane free of whatever is placed next.
  board.reserve([start, { x: start.x + 1, y }], 'lane-end');
  return { item, start, drills, drill };
}

import { describeBlock } from '../flow.js';
function describeBlockPower(id) { return describeBlock(id).powerUse; }

/**
 * Supply for one ammo/ingredient item according to the supply mode. Returns `{ start, ... }` where `start` is the first lane cell,
 * or `start: null` when items arrive by drones (a processor dock is built separately).
 */
export function buildSupply(frame, item, { anchorY, taken = new Set() } = {}) {
  const mode = frame.settings.supplyMode;
  const erekir = frame.planet === 'erekir';
  const result = { item, start: null, westEdge: frame.coreRect.startX - 1, mode, drones: ['drones', 'hybrid'].includes(mode) };
  if (mode === 'drones') return result;
  if (mode === 'local') {
    const local = erekir ? null : drillSupply(frame, item);
    if (local) return { ...result, ...local };
    const hub = bufferHub(frame, [item], anchorY);
    return hub ? { ...result, start: hub.starts[0]?.start ?? null, westEdge: hub.westEdge, hub: hub.hub } : result;
  }
  // core / hybrid
  if (erekir) {
    const hub = bufferHub(frame, [item], anchorY);
    return hub ? { ...result, start: hub.starts[0]?.start ?? null, westEdge: hub.westEdge, hub: hub.hub } : result;
  }
  const unloader = coreUnloader(frame, item, anchorY, taken);
  return unloader ? { ...result, start: unloader.start, unloader: unloader.tile, westEdge: unloader.tile.x } : result;
}

export { coreUnloader };
