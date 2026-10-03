import { blockSize, footprint, rectCenter } from '../geometry.js';
import { logicConfig, linkPrefix } from '../logic.js';
import { addStorage } from './extras.js';
import { itemConfig } from './frame.js';
import { findFreeRect } from './power.js';
import { blockName } from './profile.js';

const goalLabels = { processor: 'Контроллер', display: 'Информационная панель', switch: 'Система переключателей' };

/** Ready-made MLOG programs. The comment gives the link order the code relies on (`getlink name index`). */
const programs = {
  // links: core, memory cell, message
  processor: [
    'getlink core 0', 'getlink cell 1', 'getlink msg 2',
    'sensor cu core @copper', 'sensor pb core @lead', 'sensor si core @silicon',
    'write cu cell 0', 'write pb cell 1', 'write si cell 2',
    'print "Медь: "', 'print cu', 'print "\\nСвинец: "', 'print pb', 'print "\\nКремний: "', 'print si',
    'printflush msg',
  ].join('\n'),
  // links: core, display
  display: [
    'getlink core 0', 'getlink display 1',
    'sensor cap core @itemCapacity', 'sensor cu core @copper', 'sensor pb core @lead', 'sensor ti core @titanium',
    'op div a cu cap', 'op div b pb cap', 'op div c ti cap',
    'op mul a a 70', 'op mul b b 70', 'op mul c c 70',
    'draw clear 20 20 24 0 0 0',
    'draw color 217 157 115 255 0 0', 'draw rect 5 5 a 15 0 0',
    'draw color 140 127 169 255 0 0', 'draw rect 5 30 b 15 0 0',
    'draw color 141 161 227 255 0 0', 'draw rect 5 55 c 15 0 0',
    'drawflush display',
  ].join('\n'),
  // links: switch, unloader, message
  switch: [
    'getlink sw 0', 'getlink unl 1', 'getlink msg 2',
    'sensor on sw @enabled', 'control enabled unl on 0 0 0',
    'print "Подача боеприпасов: "', 'print on', 'printflush msg',
  ].join('\n'),
};

function linkNames(tiles) {
  const used = new Map();
  return tiles.map(tile => {
    const prefix = linkPrefix(tile.id);
    used.set(prefix, (used.get(prefix) ?? 0) + 1);
    return `${prefix}${used.get(prefix)}`;
  });
}

/** Free spot for a block of `size` within `reach` tiles (center to center) of every target, nearest to the anchor. */
function spotNear(frame, id, targets, reach, anchor) {
  const board = frame.board;
  const size = blockSize(id);
  let best = null;
  for (let y = frame.soft.minY - 4; y <= frame.soft.maxY + 4; y += 1) {
    for (let x = frame.soft.minX - 4; x <= frame.soft.maxX + 4; x += 1) {
      const rect = { startX: x, startY: y, endX: x + size - 1, endY: y + size - 1, size };
      if (!board.rectFree(rect) || [...board.reserved.keys()].some(() => false)) continue;
      const center = rectCenter(rect);
      const ok = targets.every(target => {
        const targetCenter = rectCenter(footprint(target));
        return Math.hypot(center.x - targetCenter.x, center.y - targetCenter.y) <= reach + blockSize(target.id) / 2 - 0.25;
      });
      if (!ok) continue;
      const distance = Math.hypot(center.x - anchor.x, center.y - anchor.y);
      if (!best || distance < best.distance) best = { startX: x, startY: y, distance };
    }
  }
  return best;
}

export function buildLogic(frame) {
  const settings = frame.settings;
  const board = frame.board;
  const goal = programs[settings.goal] ? settings.goal : 'processor';
  frame.placeCore({ marginEast: 3 });
  const core = frame.coreRect;
  const yc = core.startY + Math.floor((core.size - 1) / 2);
  const processorId = frame.tier >= 2 && frame.has('logic-processor') ? 'logic-processor' : frame.pick('micro-processor', 'logic-processor');
  const reach = processorId === 'logic-processor' ? 22 : 10;
  // Variants move the whole cluster: 0 west of the core, 1 above it, 2 below it.
  const shift = frame.variant === 1 ? { x: 0, y: 5 } : frame.variant === 2 ? { x: 0, y: -5 } : { x: 0, y: 0 };
  const anchor = { x: core.startX - 6 + shift.x, y: yc + shift.y };

  // The linked blocks first, so the processor can be placed among them.
  const linked = [];
  const extras = [];
  if (goal === 'processor') {
    linked.push(frame.core);
    const cellId = frame.tier >= 1 && frame.has('memory-bank') ? 'memory-bank' : 'memory-cell';
    const cellSpot = findFreeRect(board, blockSize(cellId), blockSize(cellId), { x: core.startX - 5 + shift.x, y: yc + 3 + shift.y }, { margin: 1, region: frame.soft });
    const cell = cellSpot && board.placeAtStart(cellId, cellSpot.startX, cellSpot.startY, 0, null, { role: 'memory' });
    const msgSpot = findFreeRect(board, 1, 1, { x: core.startX - 5 + shift.x, y: yc - 3 + shift.y }, { margin: 1, region: frame.soft });
    const message = msgSpot && board.placeAtStart('message', msgSpot.startX, msgSpot.startY, 0, null, { role: 'message' });
    if (cell) linked.push(cell);
    if (message) linked.push(message);
  } else if (goal === 'display') {
    linked.push(frame.core);
    const displayId = frame.tier >= 2 && frame.has('large-logic-display') ? 'large-logic-display' : 'logic-display';
    const size = blockSize(displayId);
    const spot = findFreeRect(board, size, size, { x: core.startX - 4 - size + shift.x, y: yc + shift.y }, { margin: 1, region: frame.soft });
    const display = spot && board.placeAtStart(displayId, spot.startX, spot.startY, 0, null, { role: 'display' });
    if (display) linked.push(display);
  } else {
    // A switch that turns an ammo unloader on and off, feeding a duo that stands next to it.
    const unloader = board.place(frame.profile.unloader, core.startX - 1, yc, 0, itemConfig('copper'), { role: 'unloader', item: 'copper' });
    const duo = unloader && frame.has('duo') ? board.place('duo', core.startX - 2, yc, 0, null, { role: 'turret' }) : null;
    const switchSpot = findFreeRect(board, 1, 1, { x: core.startX - 5 + shift.x, y: yc + 3 + shift.y }, { margin: 1, region: frame.soft });
    const toggle = switchSpot && board.placeAtStart('switch', switchSpot.startX, switchSpot.startY, 0, null, { role: 'switch' });
    const msgSpot = findFreeRect(board, 1, 1, { x: core.startX - 5 + shift.x, y: yc - 3 + shift.y }, { margin: 1, region: frame.soft });
    const message = msgSpot && board.placeAtStart('message', msgSpot.startX, msgSpot.startY, 0, null, { role: 'message' });
    if (toggle) linked.push(toggle);
    if (unloader) linked.push(unloader);
    if (message) linked.push(message);
    extras.push(duo);
  }
  void extras;
  if (!linked.length) { frame.fail('Не удалось собрать блоки для логики.'); return { goalId: goal, label: goalLabels[goal] }; }

  const targets = linked.filter(Boolean);
  const spot = spotNear(frame, processorId, targets, reach, anchor);
  if (!spot) { frame.fail('Не нашлось места для процессора в зоне связи.'); return { goalId: goal, label: goalLabels[goal] }; }
  const processor = board.placeAtStart(processorId, spot.startX, spot.startY, 0, null, { role: 'processor' });
  const names = linkNames(targets);
  processor.config = logicConfig(programs[goal], targets.map((target, index) => ({ name: names[index], x: target.x - processor.x, y: target.y - processor.y })));
  if (settings.includeStorage) addStorage(frame);
  const text = { processor: 'Монитор запасов: процессор читает медь, свинец и кремний из ядра, пишет их в ячейку памяти и выводит текст в сообщение.', display: 'Панель: столбцы запасов меди, свинца и титана относительно ёмкости ядра рисуются на логическом экране.', switch: 'Переключатель включает и выключает разгрузчик меди, который подаёт патроны в двойную турель.' }[goal];
  frame.note(`${text} Код и связи уже записаны в процессор (${blockName(processorId)}).`);
  frame.note(`Порядок связей: ${targets.map((target, index) => `${index} — ${blockName(target.id)}`).join('; ')}. Дальность связи — ${reach} клеток от процессора.`);
  return { goalId: goal, label: goalLabels[goal], processor };
}
