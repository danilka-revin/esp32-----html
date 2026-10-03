import { analyzeFlow, describeBlock, reconstructorInfo, unitFactoryInfo } from '../flow.js';
import { blockSize, footprint } from '../geometry.js';
import { buildLogicProgram } from '../logic.js';
import { addDroneDock, addProcessor } from './dock.js';
import { addStorage } from './extras.js';
import { itemConfig } from './frame.js';
import { routeLanes } from './lanes.js';
import { addLiquidSupply } from './machines.js';
import { addExternalPort, addPlant, connectPower, findFreeRect, powerDemand, writeNodeLinks } from './power.js';
import { planCount, rateTarget, reportRate } from './rate.js';
import { blockName, itemName } from './profile.js';

const chains = {
  serpulo: {
    ground: ['ground-factory', 'additive-reconstructor', 'multiplicative-reconstructor'],
    air: ['air-factory', 'additive-reconstructor', 'multiplicative-reconstructor'],
    naval: ['naval-factory', 'additive-reconstructor', 'multiplicative-reconstructor'],
  },
  erekir: {
    ground: ['tank-fabricator', 'tank-refabricator', 'prime-refabricator'],
    naval: ['ship-fabricator', 'ship-refabricator', 'prime-refabricator'],
    mech: ['mech-fabricator', 'mech-refabricator', 'prime-refabricator'],
  },
};

const goalLabels = { ground: 'Наземные юниты', air: 'Воздушные юниты', naval: 'Морские юниты', mech: 'Мехи' };

/** Items a block consumes (factory: first plan, reconstructor: its upgrade recipe) with per-second rates. */
function demandOf(id) {
  const factory = unitFactoryInfo(id);
  if (factory) {
    const plan = factory.plans[0];
    return { items: Object.fromEntries(Object.entries(plan.cost).map(([item, amount]) => [item, amount * 60 / plan.time])), liquids: {}, unit: plan.unit };
  }
  const reconstructor = reconstructorInfo(id);
  if (reconstructor) {
    return {
      items: Object.fromEntries(Object.entries(reconstructor.cost).map(([item, amount]) => [item, amount * 60 / (reconstructor.time || 600)])),
      liquids: reconstructor.liquids ?? {}, unit: null,
    };
  }
  return { items: {}, liquids: {}, unit: null };
}

function upgradeNames(chain) {
  const names = [unitFactoryInfo(chain[0])?.plans[0]?.unit];
  let current = names[0];
  for (const id of chain.slice(1)) {
    const next = reconstructorInfo(id)?.upgrades.find(([from]) => from === current)?.[1];
    if (!next) break;
    names.push(next);
    current = next;
  }
  return names.filter(Boolean);
}

/** The ingredient that most blocks of a unit chain consume (silicon on both planets). */
export function sharedIngredient(frame, goal) {
  const table = chains[frame.planet];
  const key = table[goal] ? goal : Object.keys(table)[0];
  const chain = table[key].filter(id => frame.has(id)).slice(0, Math.max(1, frame.tier + 1));
  const counts = new Map();
  for (const id of chain) for (const item of Object.keys(demandOf(id).items)) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Units are produced by a chain of blocks that touch each other: units slide from one into the next in the direction
 * the blocks face. The block faces are non-dumping, so a lane may run right along them and feed them through routers.
 * The ingredient shared by most blocks (silicon) uses one such lane on the near side; every other ingredient gets
 * its own lane to a port on the far side.
 */
/**
 * One row of the chain: the blocks, the shared-ingredient lane along them, a pipe or a port for every other
 * ingredient, and the drone docks. Rows are independent, so the outer builder can repeat them for a target.
 */
function placeUnitChain(frame, { chain, core, flip, spaced, gap, payloadId, rowSpine, edge, useHub }) {
  const settings = frame.settings;
  const board = frame.board;
  const planet = frame.planet;
  const placed = [];
  let failed = 0;
  let cursor = core.startX - 1 - gap;
  for (const [index, id] of chain.entries()) {
    const size = blockSize(id);
    const startY = flip ? edge : edge - size + 1;
    const tile = board.placeAtStart(id, cursor - size + 1, startY, 2, null, { role: index === 0 ? 'factory' : 'reconstructor' });
    if (!tile) { frame.fail(`Не нашлось места для «${blockName(id)}».`); failed += 1; break; }
    if (unitFactoryInfo(id) && planet === 'serpulo') tile.config = 0;
    placed.push(tile);
    cursor -= size;
    if (spaced && index < chain.length - 1 && frame.has(payloadId)) {
      // A payload conveyor carries the unit across a gap (units keep their direction).
      const psize = blockSize(payloadId);
      const conveyor = board.placeAtStart(payloadId, cursor - psize + 1, flip ? edge : edge - psize + 1, 2, null, { role: 'payload' });
      if (conveyor) cursor -= psize;
    }
  }
  if (!placed.length) return null;

  // Shared ingredient: the one used by most blocks.
  const demands = placed.map(tile => demandOf(tile.id));
  const counts = new Map();
  for (const demand of demands) for (const item of Object.keys(demand.items)) counts.set(item, (counts.get(item) ?? 0) + 1);
  const shared = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mode = settings.supplyMode;
  const router = frame.profile.router;
  const belt = frame.belt(2);
  const laneDir = 2;

  if (shared && mode !== 'drones') {
    // Supply of the shared lane: Serpulo unloader on the core, or a buffer container beside the lane start.
    // Every row past the first is too far from the core face for an unloader, so it gets its own container.
    const startX = core.startX - 2;
    let fed = false;
    if (planet === 'serpulo' && !useHub) {
      const slot = { x: core.startX - 1, y: rowSpine };
      fed = Boolean(board.place(frame.profile.unloader, slot.x, slot.y, 0, itemConfig(shared), { role: 'unloader', item: shared }));
    } else {
      const hubId = frame.has('reinforced-container') ? 'reinforced-container' : frame.has('container') ? 'container' : null;
      if (hubId) {
        const hubSize = blockSize(hubId);
        const unloaderY = flip ? rowSpine - 1 : rowSpine + 1;
        const hubStartY = flip ? unloaderY - hubSize : unloaderY + 1;
        const hub = board.placeAtStart(hubId, startX - hubSize + 1, hubStartY, 0, null, { role: 'hub' });
        const unloader = hub && board.place(frame.profile.unloader, startX, unloaderY, flip ? 1 : 3, itemConfig(shared), { role: 'unloader', item: shared });
        fed = Boolean(unloader);
        if (hub) {
          const inlet = { x: startX - hubSize, y: hubStartY };
          if (board.isFree(inlet.x, inlet.y)) { board.place(belt, inlet.x, inlet.y, 0, null, { role: 'inlet', lane: true }); frame.inlet({ x: inlet.x, y: inlet.y, kind: 'item', id: null }); }
          frame.require(`Наполни контейнер: «${itemName(shared)}» (и остальные ингредиенты — по отдельным линиям).`);
        }
      }
    }
    if (fed) {
      const westX = Math.min(...placed.map(tile => footprint(tile).startX));
      const routerXs = placed.map(tile => { const rect = footprint(tile); return rect.startX + Math.floor((rect.size - 1) / 2); }).filter((x, index) => demandOf(placed[index].id).items[shared]);
      const lastRouter = Math.min(...routerXs);
      for (let x = startX; x >= lastRouter; x -= 1) {
        if (routerXs.includes(x)) board.place(router, x, rowSpine, planet === 'erekir' ? laneDir : 0, null, { role: 'router' });
        else board.place(belt, x, rowSpine, laneDir, null, { role: 'spine', lane: true });
      }
      void westX;
    } else { frame.fail('Не удалось подать общий ингредиент вдоль цепочки.'); failed += 1; }
  }

  // Every other ingredient: a lane of its own to a port on the far face.
  const jobs = [];
  for (const [index, tile] of placed.entries()) {
    const rect = footprint(tile);
    Object.entries(demands[index].items).filter(([item]) => item !== shared || mode === 'drones').forEach(([item, rate], slot) => {
      const x = rect.startX + Math.min(rect.size - 1, 1 + slot * 2 > rect.size - 1 ? slot : 1 + slot * 2 - 1);
      const portY = flip ? rect.endY + 1 : rect.startY - 1;
      jobs.push({ item, north: flip, port: { x, y: portY, rotation: flip ? 3 : 1 }, rate });
    });
  }
  // Pipes first: they take one cell of a face, then the item lanes route around them (ports stay reserved meanwhile).
  const portCells = jobs.flatMap(job => [{ x: job.port.x, y: job.port.y }, { x: job.port.x - (job.port.rotation === 0 ? 1 : job.port.rotation === 2 ? -1 : 0), y: job.port.y - (job.port.rotation === 1 ? 1 : job.port.rotation === 3 ? -1 : 0) }]);
  board.reserve(portCells.filter(cell => board.isFree(cell.x, cell.y)), 'port');
  for (const [index, tile] of placed.entries()) {
    if (Object.keys(demands[index].liquids).length) addLiquidSupply(frame, tile, { liquids: demands[index].liquids });
  }
  board.releaseReservation(portCells);
  if (mode !== 'drones' && jobs.length) failed += routeLanes(frame, jobs);

  // Drone / processor extras.
  if (['drones', 'hybrid'].includes(mode)) {
    for (const [index, tile] of placed.entries()) {
      // Drones alone must bring every ingredient; next to a supply lane one dock for the main ingredient is a bonus.
      const ranked = Object.entries(demands[index].items).sort((a, b) => b[1] - a[1]).map(([item]) => item);
      for (const item of mode === 'hybrid' ? ranked.slice(0, 1) : ranked) addDroneDock(frame, { target: tile, item, optional: mode === 'hybrid' });
    }
  } else if (settings.processorControl && planet === 'serpulo' && frame.core) {
    const program = buildLogicProgram({ ...settings, direction: 'units' });
    if (program) addProcessor(frame, { links: [frame.core, placed[0]], program, anchor: placed[0] });
  }
  return { placed, demands, shared, failed };
}

export function buildUnits(frame) {
  const settings = frame.settings;
  const board = frame.board;
  const planet = frame.planet;
  const table = chains[planet];
  const goal = table[settings.goal] ? settings.goal : Object.keys(table)[0];
  frame.placeCore({ marginEast: 3 });
  const core = frame.coreRect;
  const flip = frame.variant === 1;
  const spaced = frame.variant === 2;
  const available = table[goal].filter(id => frame.has(id));
  const chain = available.slice(0, Math.max(1, Math.min(available.length, frame.tier + 1)));
  const payloadId = planet === 'erekir' ? 'reinforced-payload-conveyor' : 'payload-conveyor';
  // A single block has nothing to space out, so the third candidate moves it further from the core instead.
  const gap = spaced && chain.length < 2 ? 5 : 2;

  // A target in units/minute becomes a number of parallel chains: one factory line makes `perFactory` of them.
  const firstPlan = unitFactoryInfo(chain[0] ?? '')?.plans?.[0];
  const perFactory = firstPlan?.time ? 60 / firstPlan.time : 0;
  const target = rateTarget(settings, 'units');
  // Two chains is the ceiling: the core has one free face above and one below, and a chain is fed from the face it
  // hugs, so a third line would have to cross a built one. A target past that is reported as a shortfall.
  // Erekir cores cannot be unloaded, so every line there needs its own buffer container beside the core; only the
  // first one has room for it. Serpulo unloads both faces, so it can run two.
  const plan = planCount({ target, per: perFactory, min: 1, max: planet === 'erekir' ? 1 : 2, perMinute: true });
  const chainCount = plan.count ?? 1;

  // A second line sits one block-height beyond the first and faces the other way: its ports (and so its lanes)
  // point away from the first row, so the two never have to cross. Further rows would need a corridor through a
  // built line, so two is where this stops - a bigger target is reported as a shortfall instead.
  const maxSize = Math.max(...chain.map(blockSize));
  const spines = [flip ? core.startY : core.endY, flip ? core.startY - maxSize : core.endY + maxSize];
  // Every extra line is built on a throw-away copy and only kept when it really runs: a second line that cannot
  // be fed would leave the whole blueprint broken, and one working line is a better answer than two broken ones.
  const broken = frameLike => { try { return analyzeFlow(frameLike.scheme({})).errors; } catch { return 0; } };
  const rows = [];
  for (let row = 0; row < chainCount; row += 1) {
    const rowFlip = row % 2 === 0 ? flip : !flip;
    const rowSpine = spines[row] ?? spines.at(-1);
    const host = row === 0 ? frame : frame.fork();
    const before = row === 0 ? 0 : broken(host);
    const built = placeUnitChain(host, { chain, core, flip: rowFlip, spaced, gap, payloadId, rowSpine, edge: rowFlip ? rowSpine + 1 : rowSpine - 1, useHub: row > 0 || planet === 'erekir' });
    if (!built?.placed?.length) break;
    if (row > 0) {
      if (built.failed || broken(host) > before) break;
      frame.adopt(host);
    }
    rows.push(built);
  }
  const placed = rows.flatMap(row => row.placed);
  if (!placed.length) return { goalId: goal, label: goalLabels[goal] ?? 'Юниты' };
  const demands = rows.flatMap(row => row.demands);
  const shared = rows[0].shared;
  // Power.
  const nodeId = frame.pick(frame.profile.node);
  // Read the board fresh: adopting an extra line replaced it, and a captured one would leave the plant short.
  if (frame.board.tiles.some(tile => describeBlock(tile.id).powerUse > 0)) {
    if (settings.includePower) addPlant(frame, powerDemand(frame.board.tiles), { x: core.startX - 6, y: flip ? core.endY + 10 : core.startY - 8 });
    connectPower(frame, { nodeId });
    if (!settings.includePower) { addExternalPort(frame, { nodeId }); frame.require(`Подключи внешнее питание: до ${Math.round(powerDemand(frame.board.tiles))} ед./с.`); }
    writeNodeLinks(frame);
  }
  if (settings.includeStorage) addStorage(frame);
  const names = upgradeNames(chain);
  const lines = rows.length > 1 ? ` ${rows.length} параллельные линии;` : '';
  frame.note(`Цепочка юнитов:${lines} ${chain.map(id => blockName(id)).join(' → ')} (${names.join(' → ')}). Блоки стоят вплотную по направлению стрелки: юнит переезжает из одного в другой, последний выпускает его на свободное место.`);
  reportRate(frame, { direction: 'units', target, per: perFactory, count: rows.length, noun: names.at(-1) ?? 'юнитов', blocks: '× линия' });
  if (shared) frame.note(`Общий ингредиент «${itemName(shared)}» идёт одной линией вдоль блоков: маршрутизаторы касаются каждого потребителя; остальное — отдельные линии с другой стороны.`);
  if (planet === 'serpulo') frame.note('План завода сохранён в схеме: производится первый юнит списка; сменить его можно в игре.');
  void findFreeRect;
  return { goalId: goal, label: goalLabels[goal] ?? 'Юниты', chain: placed };
}
