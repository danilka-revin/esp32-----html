import facts from '../block-facts.json' with { type: 'json' };
import data from '../mechanics-data.json' with { type: 'json' };
import { blockSize, footprint, ringCells } from '../geometry.js';
import { availableOn, blockName, itemName, stageTier, techTier } from './profile.js';
import { itemConfig } from './frame.js';

const costWeight = id => Object.values(facts[id]?.cost ?? {}).reduce((sum, amount) => sum + amount, 0);

/** Item turrets that accept `item` on this planet, cheapest and most available first. */
export function turretsAccepting(frame, item, { air = null, ground = null, maxSize = 4 } = {}) {
  return Object.entries(data.turrets)
    .filter(([id, info]) => info.class === 'ItemTurret' && info.ammo.includes(item) && availableOn(id, frame.planet)
      && blockSize(id) <= maxSize && (air == null || info.air === air) && (ground == null || info.ground === ground))
    .map(([id]) => id)
    .sort((a, b) => {
      const overA = Math.max(0, techTier(a, frame.planet) - frame.tier);
      const overB = Math.max(0, techTier(b, frame.planet) - frame.tier);
      return overA - overB || blockSize(a) - blockSize(b) || costWeight(a) - costWeight(b);
    });
}

/** Core-linked storage (container/vault) glued to a free part of the core's outline. */
export function addStorage(frame) {
  const board = frame.board;
  const planet = frame.planet;
  const ids = planet === 'erekir'
    ? [frame.tier >= 2 ? 'reinforced-vault' : null, 'reinforced-container']
    : [frame.tier >= 2 ? 'vault' : null, 'container'];
  const id = ids.find(candidate => candidate && availableOn(candidate, planet));
  if (!id) return null;
  const size = blockSize(id);
  const core = frame.coreRect;
  const options = [];
  // Along north and south faces, fully touching the core.
  for (const side of [1, 3, 0]) {
    for (let offset = -size + 1; offset <= core.size - 1; offset += 1) {
      const startX = side === 0 ? core.endX + 1 : core.startX + offset;
      const startY = side === 1 ? core.endY + 1 : side === 3 ? core.startY - size : core.startY + offset;
      options.push({ startX, startY, side });
    }
  }
  for (const option of options) {
    const rect = { startX: option.startX, startY: option.startY, endX: option.startX + size - 1, endY: option.startY + size - 1, size };
    const touchesCore = ringCells(core).some(cell => cell.x >= rect.startX && cell.x <= rect.endX && cell.y >= rect.startY && cell.y <= rect.endY);
    if (!touchesCore || !board.rectFree(rect)) continue;
    // Do not park a container next to lane ends or unloaders: they would feed it by accident.
    const crowded = ringCells(rect).some(cell => {
      const tile = board.tileAt(cell.x, cell.y);
      return tile && (tile.meta?.lane || ['unloader', 'duct-unloader'].includes(tile.id));
    });
    if (crowded) continue;
    const tile = board.placeAtStart(id, rect.startX, rect.startY, 0, null, { role: 'storage' });
    if (tile) {
      frame.note(`Хранилище: ${blockName(id)} стыкуется с ядром и увеличивает общий запас.`);
      return tile;
    }
  }
  return null;
}

export function ammoLabel(item) { return itemName(item); }
export { itemConfig, stageTier, footprint };
