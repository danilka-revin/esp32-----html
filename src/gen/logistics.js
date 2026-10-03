import { blockSize, footprint, DIRS } from '../geometry.js';
import { addStorage } from './extras.js';
import { itemConfig } from './frame.js';
import { addExternalPort, addPlant, connectPower, powerDemand, writeNodeLinks } from './power.js';
import { blockName, itemName, rawItems } from './profile.js';
import { coreUnloader } from './supply.js';
import { describeBlock } from '../flow.js';

const goalLabels = { conveyor: 'Конвейерная магистраль', sort: 'Сортировка ресурсов', driver: 'Масс-драйверы' };

function sampleItems(frame, count) {
  const preferred = frame.planet === 'erekir' ? ['beryllium', 'graphite', 'sand', 'tungsten'] : ['copper', 'lead', 'sand', 'coal', 'titanium'];
  return preferred.filter(item => rawItems(frame.planet).includes(item)).slice(0, count);
}

function trunkSpec(frame) {
  const core = frame.coreRect;
  const yc = core.startY + Math.floor((core.size - 1) / 2);
  const xEnd = core.startX - 1;
  const length = Math.max(12, xEnd - frame.soft.minX);
  return { yc, xEnd, xStart: xEnd - length + 1 };
}

/** Merge bus: a trunk into the core with side feeders joining it (conveyors accept from their sides). */
function mergeBus(frame, variant) {
  const board = frame.board;
  const { yc, xEnd, xStart } = trunkSpec(frame);
  const items = sampleItems(frame, 3);
  const feeders = Math.min(2, items.length - 1);
  const rate = frame.planet === 'erekir' ? Math.min(15, items.length * 4) : items.length * 4.2;
  const trunk = frame.belt(rate);
  const feeder = frame.belt(4.2);
  const bridgeAt = variant === 2 ? Math.floor((xStart + xEnd) / 2) - 2 : null;
  const bridgeId = frame.planet === 'erekir' ? 'duct-bridge' : 'bridge-conveyor';
  for (let x = xStart; x <= xEnd; x += 1) {
    if (bridgeAt != null && x > bridgeAt && x < bridgeAt + 4) continue;
    if (bridgeAt != null && (x === bridgeAt || x === bridgeAt + 4) && frame.has(bridgeId)) {
      const start = x === bridgeAt;
      const config = frame.planet === 'erekir' ? null : (start ? { type: 'point2', x: 4, y: 0 } : null);
      board.place(bridgeId, x, yc, 0, config, { role: 'bridge' });
    } else board.place(trunk, x, yc, 0, null, { role: 'trunk', lane: true });
  }
  frame.inlet({ x: xStart, y: yc, kind: 'item', id: items[0] });
  if (bridgeAt != null) {
    // Walls in the gap the bridge hops over.
    for (let x = bridgeAt + 1; x < bridgeAt + 4; x += 1) board.place(frame.profile.wall, x, yc, 0, null, { role: 'wall' });
    frame.note('Мост перепрыгивает препятствие: три клетки стены под ним остаются свободными для постройки.');
  }
  const gap = Math.max(4, Math.floor((xEnd - xStart) / (feeders + 1)));
  for (let index = 0; index < feeders; index += 1) {
    const x = xStart + gap * (index + 1) + (bridgeAt != null && xStart + gap * (index + 1) >= bridgeAt && xStart + gap * (index + 1) <= bridgeAt + 4 ? 5 : 0);
    const up = (index + (variant === 1 && !frame.profile.junction ? 1 : 0)) % 2 === 0;
    const length = Math.min(up ? frame.soft.maxY - yc : yc - frame.soft.minY, 6);
    for (let step = 1; step <= length; step += 1) board.place(feeder, x, up ? yc + step : yc - step, up ? 3 : 1, null, { role: 'feeder', lane: true });
    frame.inlet({ x, y: up ? yc + length : yc - length, kind: 'item', id: items[index + 1] });
  }
  if (variant === 1 && frame.profile.junction && frame.has(frame.profile.junction)) {
    // A transit line crosses the trunk through a junction and goes on to the core's south face.
    const x = xStart + Math.floor(gap / 2) + 1;
    const startY = yc + Math.min(5, frame.soft.maxY - yc);
    const slot = frame.coreFace(3).sort((a, b) => b.x - a.x)[0];
    if (slot && board.isFree(x, startY)) {
      frame.inlet({ x, y: startY, kind: 'item', id: 'scrap' });
      frame.connect({ start: { x, y: startY, dir: 3 }, end: { x: slot.x, y: slot.y }, endRotation: 1, rate: 4, label: 'транзитная линия', crossCost: 0.2 });
      frame.note('Транзитная линия пересекает магистраль через перекрёсток и входит в ядро снизу — потоки не смешиваются.');
    }
  }
  frame.note(`Магистраль: ${blockName(trunk)} несёт до ${items.length} потоков (${items.map(itemName).join(', ')}) в ядро; каждый вход — отдельная лента-притока.`);
  return { items };
}

/** Sorting station: inverted sorters pull one item each to a side branch that ends in a container. */
function sortingStation(frame) {
  const board = frame.board;
  const { yc, xEnd, xStart } = trunkSpec(frame);
  const trunk = frame.belt(8);
  const branch = frame.belt(4.2);
  const containerId = frame.planet === 'erekir' ? 'reinforced-container' : 'container';
  const csize = blockSize(containerId);
  const sorterId = 'inverted-sorter';
  for (let x = xStart; x <= xEnd; x += 1) board.place(trunk, x, yc, 0, null, { role: 'trunk', lane: true });
  frame.inlet({ x: xStart, y: yc, kind: 'item', id: null });
  const pitch = csize + 3;
  const items = sampleItems(frame, 3).slice(0, Math.max(1, Math.floor((xEnd - xStart - 3) / pitch)));
  items.forEach((item, index) => {
    const x = xStart + 3 + index * pitch;
    const up = frame.variant === 2 ? true : (index + (frame.variant === 1 ? 1 : 0)) % 2 === 0;
    const old = board.tileAt(x, yc);
    if (old && old.meta.role === 'trunk') board.remove(old);
    board.place(sorterId, x, yc, 0, itemConfig(item), { role: 'sorter' });
    const dir = up ? 1 : 3;
    board.place(branch, x, yc + DIRS[dir].y, dir, null, { role: 'branch', lane: true });
    board.place(branch, x, yc + 2 * DIRS[dir].y, dir, null, { role: 'branch', lane: true });
    const startY = up ? yc + 3 : yc - 2 - csize;
    board.placeAtStart(containerId, x, startY, 0, null, { role: 'sorted-storage' });
  });
  frame.note(`Сортировка: инвертированные сортировщики вытаскивают ${items.map(itemName).join(', ')} в контейнеры; остальное идёт дальше в ядро.`);
  frame.note('На вход подай смешанный поток: сортировщик отдаёт «свой» предмет вбок, остальные пропускает вперёд.');
  return { items };
}

/** Mass driver pair: the sender is fed by an unloader lane and linked to the receiver with a container. */
function driverPair(frame) {
  const board = frame.board;
  const settings = frame.settings;
  const core = frame.coreRect;
  const yc = core.startY + Math.floor((core.size - 1) / 2);
  const id = 'mass-driver';
  const size = blockSize(id);
  const item = settings.transportItem && rawItems(frame.planet).includes(settings.transportItem) ? settings.transportItem : 'copper';
  const supply = coreUnloader(frame, item, yc);
  const distance = frame.variant === 2 ? Math.max(14, Math.min(30, frame.width - size - 4)) : Math.max(10, Math.min(24, frame.width - size - 8));
  const senderX = core.startX - 1 - 4 - size;
  const sender = board.placeAtStart(id, senderX, yc - Math.floor((size - 1) / 2), 0, null, { role: 'driver' });
  const receiver = board.placeAtStart(id, senderX - distance, yc - Math.floor((size - 1) / 2) + (frame.variant === 1 ? 6 : 0), 0, null, { role: 'driver' });
  if (!sender || !receiver) { frame.fail('Не хватило места для масс-драйверов.'); return { items: [item] }; }
  sender.config = { type: 'point2', x: receiver.x - sender.x, y: receiver.y - sender.y };
  const rect = footprint(receiver);
  const storage = frame.has('container') ? board.placeAtStart('container', rect.startX - 2, rect.startY, 0, null, { role: 'storage' }) : null;
  void storage;
  if (supply) frame.connect({ start: supply.start, end: { x: footprint(sender).endX + 1, y: sender.y }, endRotation: 2, rate: 4, label: `подача «${itemName(item)}» в драйвер` });
  frame.note(`Масс-драйверы: передатчик связан с приёмником на расстоянии ${distance} клеток; приёмник сбрасывает «${itemName(item)}» в соседний контейнер.`);
  return { items: [item], drivers: [sender, receiver] };
}

export function buildLogistics(frame) {
  const settings = frame.settings;
  const goal = ['conveyor', 'sort', 'driver'].includes(settings.goal) ? settings.goal : 'conveyor';
  frame.placeCore({ marginEast: 3 });
  const effective = frame.planet === 'erekir' && goal !== 'conveyor' ? 'conveyor' : goal;
  let info;
  if (effective === 'sort') info = sortingStation(frame);
  else if (effective === 'driver') info = driverPair(frame);
  else info = mergeBus(frame, frame.variant);
  const board = frame.board;
  const powered = board.tiles.some(tile => describeBlock(tile.id).powerUse > 0);
  if (powered) {
    const nodeId = frame.pick(frame.profile.node);
    if (settings.includePower) addPlant(frame, powerDemand(board.tiles), { x: frame.soft.minX + 8, y: frame.coreRect.startY + 6 });
    connectPower(frame, { nodeId });
    if (!settings.includePower) { addExternalPort(frame, { nodeId }); frame.require('Подключи внешнее питание к силовым узлам.'); }
    writeNodeLinks(frame);
  }
  if (settings.includeStorage) addStorage(frame);
  return { goalId: goal, label: goalLabels[goal] ?? 'Логистика', ...info };
}
