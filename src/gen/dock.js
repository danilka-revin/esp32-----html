import { blockSize, footprint, opposite, rectCenter, ringCells } from '../geometry.js';
import { describeBlock } from '../flow.js';
import { buildLogicProgram, getLogicLinkInstructions, linkPrefix, logicConfig, needsLogicProgram } from '../logic.js';
import { blockName, itemName } from './profile.js';
import { itemConfig } from './frame.js';

const processorRange = { 'micro-processor': 10, 'logic-processor': 22, 'hyper-processor': 42 };

/** Link names the way Mindustry assigns them: block prefix plus the lowest free number. */
function linkNames(tiles) {
  const used = new Map();
  return tiles.map(tile => {
    const prefix = linkPrefix(tile.id);
    const next = (used.get(prefix) ?? 0) + 1;
    used.set(prefix, next);
    return `${prefix}${next}`;
  });
}

/** Free cell for a processor that can link every target (center distance <= range + half the target size). */
function processorSpot(frame, id, targets, anchor) {
  const board = frame.board;
  const size = blockSize(id);
  const range = processorRange[id] ?? 10;
  let best = null;
  for (let y = frame.soft.minY - 4; y <= frame.soft.maxY + 4; y += 1) {
    for (let x = frame.soft.minX - 4; x <= frame.soft.maxX + 4; x += 1) {
      const candidate = { id, x: x + Math.floor((size - 1) / 2), y: y + Math.floor((size - 1) / 2) };
      const rect = footprint(candidate);
      if (!board.rectFree(rect)) continue;
      const center = rectCenter(rect);
      const reachable = targets.every(target => {
        const targetCenter = rectCenter(footprint(target));
        return Math.hypot(center.x - targetCenter.x, center.y - targetCenter.y) <= range + blockSize(target.id) / 2 - 0.25;
      });
      if (!reachable) continue;
      const tooClose = ringCells(rect).some(cell => {
        const tile = board.tileAt(cell.x, cell.y);
        return tile && ['unloader', 'duct-unloader'].includes(tile.id);
      });
      if (tooClose) continue;
      const distance = Math.hypot(center.x - anchor.x, center.y - anchor.y);
      if (!best || distance < best.distance) best = { x: candidate.x, y: candidate.y, distance };
    }
  }
  return best;
}

/**
 * Serpulo: a processor with ready MLOG and the links already written into the schematic.
 * `links` are the buildings in the order the program expects (the reserve program wants the core first).
 */
export function addProcessor(frame, { links, program, anchor }) {
  const id = frame.pick('micro-processor', 'logic-processor');
  if (!id || !program) return null;
  const spot = processorSpot(frame, id, links, anchor ?? links[0]);
  if (!spot) { frame.fail('Не нашлось места для процессора рядом со связываемыми блоками.'); return null; }
  const tile = frame.board.place(id, spot.x, spot.y, 0, null, { role: 'processor' });
  if (!tile) return null;
  const names = linkNames(links);
  tile.config = logicConfig(program, links.map((target, index) => ({ name: names[index], x: target.x - tile.x, y: target.y - tile.y })));
  return tile;
}

/** Drone delivery: Serpulo processor + unit, Erekir cargo loader and unload point. */
export function addDroneDock(frame, { targets, target, item, optional = false }) {
  const complain = text => (optional ? frame.note(`${text} Линия подачи работает и без дрона.`) : frame.fail(text));
  const candidates = targets ?? [target];
  const goal = candidates[0];
  const settings = { ...frame.settings, transportItem: item };
  if (frame.planet === 'serpulo') {
    const program = buildLogicProgram({ ...settings, supplyMode: 'drones' });
    const processor = addProcessor(frame, { links: [goal], program, anchor: goal });
    if (processor) {
      frame.note(`Дроны: процессор уже связан с блоком «${blockName(goal.id)}» и содержит код доставки «${itemName(item)}».`);
      frame.require(`Нужен юнит «${frame.settings.droneUnit ?? 'mono'}» в зоне процессора: выпусти его заводом юнитов.`);
    }
    return processor;
  }
  // Erekir: unload point glued to the target, loader nearby fed from outside.
  const board = frame.board;
  const unloadId = 'unit-cargo-unload-point';
  const loaderId = 'unit-cargo-loader';
  if (!frame.has(unloadId) || !frame.has(loaderId)) return null;
  const size = blockSize(unloadId);
  let unload = null;
  // Where may an unload point touch a block? Duct routers accept from behind only, belts from behind and the sides.
  const acceptsFrom = (tile, side) => {
    const info = describeBlock(tile.id);
    if (info.kind === 'ductRouter' || info.kind === 'ductGate') return side === opposite(tile.rotation);
    if (info.kind === 'belt' || info.kind === 'armored') return side !== tile.rotation;
    return true;
  };
  for (const targetTile of candidates) {
    const ring = ringCells(footprint(targetTile));
    for (const cell of ring) {
      if (!acceptsFrom(targetTile, cell.side)) continue;
      for (let dx = 0; dx < size && !unload; dx += 1) {
        for (let dy = 0; dy < size && !unload; dy += 1) {
          const startX = cell.x - dx;
          const startY = cell.y - dy;
          const rect = { startX, startY, endX: startX + size - 1, endY: startY + size - 1, size };
          if (!board.rectFree(rect)) continue;
          unload = board.placeAtStart(unloadId, startX, startY, 0, itemConfig(item), { role: 'cargo-unload' });
        }
      }
      if (unload) break;
    }
    if (unload) break;
  }
  if (!unload) { complain('Не нашлось места для точки выгрузки грузового дрона.'); return null; }
  const loaderSize = blockSize(loaderId);
  const anchor = { x: frame.coreRect.startX - 6, y: frame.coreRect.startY - loaderSize - 1 };
  let loader = frame.board.tiles.find(tile => tile.id === loaderId && tile.meta.item === item) ?? null;
  for (let radius = 0; radius < 14 && !loader; radius += 1) {
    for (let dy = -radius; dy <= radius && !loader; dy += 1) {
      for (let dx = -radius; dx <= radius && !loader; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        loader = board.placeAtStart(loaderId, anchor.x + dx, anchor.y + dy, 0, null, { role: 'cargo-loader', item });
        if (loader) {
          // Supply stubs the player connects: items in, nitrogen in (the loader refuses to work without it).
          const ring = ringCells(footprint(loader)).filter(cell => board.isFree(cell.x, cell.y));
          const itemCell = ring[0];
          const gasCell = ring.find(cell => cell !== itemCell && (cell.x !== itemCell.x || cell.y !== itemCell.y));
          if (itemCell) {
            board.place(frame.belt(1), itemCell.x, itemCell.y, itemCell.toward, null, { role: 'inlet', lane: true });
            frame.inlet({ x: itemCell.x, y: itemCell.y, kind: 'item', id: item });
          }
          const conduit = frame.profile.conduits.find(entry => frame.has(entry.id))?.id;
          if (gasCell && conduit) {
            board.place(conduit, gasCell.x, gasCell.y, gasCell.toward, null, { role: 'inlet', lane: true });
            frame.inlet({ x: gasCell.x, y: gasCell.y, kind: 'liquid', id: 'nitrogen' });
          }
        }
      }
    }
  }
  if (!loader) { complain('Не нашлось места для грузового загрузчика.'); return null; }
  frame.require(`Подай «${itemName(item)}» и азот в загрузчик: он сам создаёт грузовых дронов (Manifold).`);
  return { unload, loader };
}

export { needsLogicProgram, getLogicLinkInstructions };
