import { blockSize, footprint } from '../geometry.js';
import { addStorage } from './extras.js';
import { itemConfig } from './frame.js';
import { addExternalPort, addPlant, connectPower, findFreeRect, powerDemand, writeNodeLinks } from './power.js';
import { blockName, itemName } from './profile.js';
import { describeBlock } from '../flow.js';

const goalLabels = { launch: 'Экспортная площадка', accelerator: 'Межпланетный ускоритель' };

/** Unloaders on the core's west face with straight lanes into a block that stands due west of the core. */
function feedStraight(frame, target, items, rate = 4) {
  const board = frame.board;
  const core = frame.coreRect;
  const rect = footprint(target);
  const rows = [];
  for (let y = Math.max(core.startY, rect.startY); y <= Math.min(core.endY, rect.endY); y += 1) rows.push(y);
  const placed = [];
  items.slice(0, rows.length).forEach((item, index) => {
    const y = rows[index];
    const unloader = board.place(frame.profile.unloader, core.startX - 1, y, 0, itemConfig(item), { role: 'unloader', item });
    if (!unloader) return;
    const belt = frame.belt(rate);
    for (let x = core.startX - 2; x >= rect.endX + 1; x -= 1) board.place(belt, x, y, 2, null, { role: 'lane', lane: true });
    placed.push(item);
  });
  return placed;
}

function buildLaunch(frame) {
  const settings = frame.settings;
  const board = frame.board;
  const core = frame.coreRect;
  const yc = core.startY + Math.floor((core.size - 1) / 2);
  const padId = 'advanced-launch-pad';
  const size = blockSize(padId);
  const pads = frame.variant === 2 ? 2 : 1;
  const base = [settings.transportItem, 'copper', 'lead', 'silicon', 'graphite', 'titanium'].filter((item, index, all) => item && all.indexOf(item) === index);
  // Variant 1 exports the next item in line, so the three candidates differ in what they send away.
  const exported = frame.variant === 1 ? [...base.slice(1), base[0]] : base;
  const placed = [];
  const lane = 4;
  for (let index = 0; index < pads; index += 1) {
    // Two pads sit one above the other so both reach the core's west face.
    const offset = pads === 1 ? 0 : (index === 0 ? 1 : -1) * Math.ceil(size / 2);
    const startY = yc - Math.floor((size - 1) / 2) + offset + (frame.variant === 1 && pads === 1 ? -1 : 0);
    const pad = board.placeAtStart(padId, core.startX - 1 - lane - size, startY, 0, null, { role: 'launch-pad' });
    if (!pad) { frame.fail('Не нашлось места для пусковой площадки.'); continue; }
    const rect = footprint(pad);
    const rows = [];
    for (let y = Math.max(core.startY, rect.startY); y <= Math.min(core.endY, rect.endY); y += 1) rows.push(y);
    const item = exported[index] ?? 'copper';
    const y = rows[Math.min(rows.length - 1, index === 0 ? 0 : rows.length - 1)];
    if (y != null && board.place(frame.profile.unloader, core.startX - 1, y, 0, itemConfig(item), { role: 'unloader', item })) {
      for (let x = core.startX - 2; x >= rect.endX + 1; x -= 1) board.place(frame.belt(4), x, y, 2, null, { role: 'lane', lane: true });
    }
    // Oil comes from outside through a pipe pressed against the pad.
    const conduit = frame.profile.conduits[0].id;
    const south = pads === 2 && index === 1;
    const cell = { x: rect.startX + 1, y: south ? rect.startY - 1 : rect.endY + 1 };
    if (board.place(conduit, cell.x, cell.y, south ? 1 : 3, null, { role: 'inlet', lane: true })) frame.inlet({ x: cell.x, y: cell.y, kind: 'liquid', id: 'oil' });
    placed.push({ pad, item });
  }
  frame.require('Подай нефть (≈9/с на площадку) в трубу над площадкой и назначь сектор-получатель в кампании.');
  frame.note(`Пусковая площадка: ${placed.map(entry => `«${itemName(entry.item)}»`).join(' и ')} забирается из ядра и копится на площадке; экспорт идёт автоматически, когда груз полон.`);
  return placed.map(entry => entry.pad);
}

function buildAccelerator(frame) {
  const board = frame.board;
  const core = frame.coreRect;
  const yc = core.startY + Math.floor((core.size - 1) / 2);
  const id = 'interplanetary-accelerator';
  const size = blockSize(id);
  const accelerator = board.placeAtStart(id, core.startX - 1 - 3 - size, yc - Math.floor((size - 1) / 2), 0, null, { role: 'accelerator' });
  if (!accelerator) { frame.fail('Не нашлось места для ускорителя.'); return []; }
  // The launched core's cost: the accelerator consumes the items of a core of the next size.
  const items = frame.variant === 2 ? ['thorium', 'silicon', 'lead', 'copper'] : ['copper', 'lead', 'silicon', 'thorium'];
  const fed = feedStraight(frame, accelerator, items, 8);
  frame.note(`Ускоритель принимает ${fed.map(itemName).join(', ')} по прямым линиям от ядра (стоимость запускаемого ядра).`);
  // Battery bank: the accelerator launches only after the grid has stored a huge amount of energy.
  const batteryId = frame.has('battery-large') ? 'battery-large' : 'battery';
  const bsize = blockSize(batteryId);
  const count = Math.max(2, Math.min(20, Math.floor(frame.width * frame.height / (bsize * bsize) / 6)));
  const spot = findFreeRect(board, count > 4 ? Math.ceil(count / 2) * bsize : count * bsize, count > 4 ? 2 * bsize : bsize, { x: core.startX - 8, y: frame.variant === 1 ? yc - 10 : yc + 10 }, { margin: frame.variant === 2 ? 0 : 1, region: frame.soft })
    ?? findFreeRect(board, count * bsize, bsize, { x: core.startX - 8, y: frame.variant === 1 ? yc - 10 : yc + 10 }, { margin: 0 });
  const columns = count > 4 ? Math.ceil(count / 2) : count;
  let batteries = 0;
  if (spot) for (let index = 0; index < count; index += 1) if (board.placeAtStart(batteryId, spot.startX + (index % columns) * bsize, spot.startY + Math.floor(index / columns) * bsize, 0, null, { role: 'battery' })) batteries += 1;
  frame.note(`Накопитель: ${batteries} × ${blockName(batteryId)} (${batteries * (batteryId === 'battery-large' ? 50 : 4)} тыс. ед.). Для запуска сети нужно накопить 1 000 000 ед. — добавляй ещё батареи рядом.`);
  frame.require('Ускорителю нужна накопленная энергия 1 000 000 ед., 600 ед./с и полный комплект ресурсов; запуск — кнопкой в кампании.');
  return [accelerator];
}

export function buildCampaign(frame) {
  const settings = frame.settings;
  const goal = ['launch', 'accelerator'].includes(settings.goal) ? settings.goal : 'launch';
  frame.placeCore({ marginEast: 3 });
  const blocks = goal === 'accelerator' ? buildAccelerator(frame) : buildLaunch(frame);
  const board = frame.board;
  if (board.tiles.some(tile => describeBlock(tile.id).powerUse > 0 || describeBlock(tile.id).kind === 'battery')) {
    const nodeId = frame.pick(frame.profile.node, frame.profile.largeNode);
    if (settings.includePower) addPlant(frame, Math.min(powerDemand(board.tiles), 480), { x: frame.soft.minX + 6, y: frame.coreRect.startY - 6 });
    connectPower(frame, { nodeId });
    if (!settings.includePower || powerDemand(board.tiles) > 600) { addExternalPort(frame, { nodeId }); frame.require(`Подключи внешнее питание: до ${Math.round(powerDemand(board.tiles))} ед./с.`); }
    writeNodeLinks(frame);
  }
  if (settings.includeStorage) addStorage(frame);
  return { goalId: goal, label: goalLabels[goal], blocks };
}
