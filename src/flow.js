/**
 * Static model of Mindustry v160.2 logistics, power and liquids.
 *
 * `analyzeFlow(scheme)` answers the questions a player asks while looking at a blueprint:
 * does every belt lead somewhere that accepts its items, does each factory receive all of its
 * ingredients, do turrets get ammo, is every consumer on a powered network, are liquids connected.
 * It is deliberately conservative: it propagates the *set of item types* that can reach a block,
 * so a lane that mixes items towards a consumer that refuses one of them is reported as a jam.
 */
import facts from './block-facts.json' with { type: 'json' };
import data from './mechanics-data.json' with { type: 'json' };
import { blockById, itemById, liquids as liquidEntries } from './catalog.js';
import { DIRS, cellKey, distanceToRect, footprint, rectCenter, rectCells, ringCells } from './geometry.js';

const WILDCARD = '*';

const kindByClass = {
  Conveyor: 'belt', Duct: 'belt', ArmoredConveyor: 'armored', StackConveyor: 'stack',
  Junction: 'junction', BufferedItemBridge: 'bridge', ItemBridge: 'bridge', DuctBridge: 'ductBridge',
  Sorter: 'sorter', Router: 'router', StackRouter: 'router', DuctRouter: 'ductRouter',
  OverflowGate: 'gate', OverflowDuct: 'ductGate', Unloader: 'unloader', DirectionalUnloader: 'ductUnloader',
  MassDriver: 'driver', UnitCargoLoader: 'cargoLoader', UnitCargoUnloadPoint: 'cargoUnload',
  CoreBlock: 'core', StorageBlock: 'storage',
  GenericCrafter: 'crafter', AttributeCrafter: 'crafter', Separator: 'crafter', HeatCrafter: 'crafter', HeatProducer: 'crafter',
  Fracker: 'crafter', Incinerator: 'incinerator', ItemIncinerator: 'incinerator',
  Drill: 'drill', BeamDrill: 'drill', BurstDrill: 'drill', WallCrafter: 'drill',
  ItemTurret: 'turret', LiquidTurret: 'turret', PowerTurret: 'turret', ContinuousLiquidTurret: 'turret',
  ContinuousTurret: 'turret', LaserTurret: 'turret', TractorBeamTurret: 'turret', PointDefenseTurret: 'turret',
  ConsumeGenerator: 'generator', ThermalGenerator: 'generator', SolarGenerator: 'generator', NuclearReactor: 'generator',
  ImpactReactor: 'generator', VariableReactor: 'generator', HeaterGenerator: 'generator',
  UnitFactory: 'unitFactory', Reconstructor: 'reconstructor', UnitAssembler: 'assembler',
  LaunchPad: 'launchPad', LandingPad: 'landingPad', Accelerator: 'accelerator',
  PowerNode: 'node', BeamNode: 'beam', LongPowerNode: 'node', Battery: 'battery', PowerDiode: 'diode',
  Pump: 'pump', SolidPump: 'pump', Conduit: 'conduit', ArmoredConduit: 'armoredConduit',
  LiquidRouter: 'liquidRouter', LiquidJunction: 'liquidJunction', LiquidBridge: 'liquidBridge', DirectionLiquidBridge: 'liquidBridge',
  LogicBlock: 'processor', MemoryBlock: 'memory', LogicDisplay: 'display', TileableLogicDisplay: 'display', SwitchBlock: 'switch', MessageBlock: 'message',
};

const itemBelts = new Set(['belt', 'armored', 'stack']);
const dumpers = new Set(['crafter', 'drill', 'unloader', 'router', 'sorter', 'gate', 'landingPad', 'cargoUnload']);

const descriptorCache = new Map();

/** Everything the flow model needs to know about one block id. */
export function describeBlock(id) {
  if (descriptorCache.has(id)) return descriptorCache.get(id);
  const fact = facts[id] ?? {};
  const cls = data.classes[id] ?? null;
  let kind = kindByClass[cls] ?? 'other';
  if (id === 'armored-duct') kind = 'armored';
  if (id === 'surge-router') kind = 'router';
  const turret = data.turrets[id];
  const generator = data.generators[id];
  const factory = data.unitFactories[id];
  const reconstructor = data.reconstructors[id];
  const optionalLiquids = new Set(data.optionalLiquids[id] ?? []);
  const optionalItems = new Set(data.optionalItems[id] ?? []);
  const items = new Set();
  let anyItem = false;
  if (turret) turret.ammo.forEach(item => items.add(item));
  if (kind === 'crafter' || kind === 'generator' || kind === 'reconstructor') Object.keys(fact.inputs ?? {}).forEach(item => items.add(item));
  if (reconstructor) Object.keys(reconstructor.cost ?? {}).forEach(item => items.add(item));
  if (factory) factory.plans.forEach(plan => Object.keys(plan.cost).forEach(item => items.add(item)));
  if (generator?.fuel === 'flammable') {
    for (const [item, props] of Object.entries(data.items)) if (props.flammability >= 0.2) items.add(item);
  } else if (generator?.fuel === 'radioactive') {
    for (const [item, props] of Object.entries(data.items)) if (props.radioactivity >= 0.2) items.add(item);
  } else if (Array.isArray(generator?.fuel)) generator.fuel.forEach(item => items.add(item));
  optionalItems.forEach(item => items.add(item));
  if (['core', 'storage', 'launchPad', 'incinerator', 'cargoLoader', 'driver', 'accelerator'].includes(kind)) anyItem = true;

  const liquidsRequired = {};
  const liquidsAccepted = new Set();
  const addLiquid = (liquid, rate, required) => {
    liquidsAccepted.add(liquid);
    if (required) liquidsRequired[liquid] = rate;
  };
  for (const [liquid, rate] of Object.entries(fact.liquids ?? {})) addLiquid(liquid, rate, !optionalLiquids.has(liquid));
  for (const [liquid, rate] of Object.entries(generator?.liquids ?? {})) addLiquid(liquid, rate, true);
  for (const [liquid, rate] of Object.entries(turret?.needs ?? {})) addLiquid(liquid, rate, true);
  for (const [liquid, rate] of Object.entries(reconstructor?.liquids ?? {})) addLiquid(liquid, rate, true);
  for (const liquid of turret?.liquidAmmo ?? []) liquidsAccepted.add(liquid);
  if (turret?.liquidAmmo?.length) liquidsRequired[`ammo:${turret.liquidAmmo.join('|')}`] = 1;
  if (id === 'landing-pad') addLiquid('water', 1, true);
  if (id === 'advanced-launch-pad' || id === 'launch-pad') addLiquid('oil', fact.liquids?.oil ?? 9, id === 'advanced-launch-pad');

  const powerUse = fact.power ?? turret?.power ?? 0;
  const size = blockById.get(id)?.size ?? 1;
  // Thermal generators scale with the heat/vent tiles under them: assume full coverage (vents) or typical magma rock.
  const powerMake = !generator ? 0 : generator.class === 'ThermalGenerator'
    ? generator.power * size * size * (id === 'turbine-condenser' ? 1 : 0.75) : generator.power;
  const isNode = kind === 'node';
  const isBeam = kind === 'beam';
  const consumesPower = powerUse > 0 || kind === 'battery' || isBeam || (generator?.startupPower ?? 0) > 0;
  const outputsPower = powerMake > 0 || kind === 'battery' || isBeam;
  const hasPower = consumesPower || outputsPower || isNode || kind === 'diode';

  const descriptor = {
    id, kind, cls, size: blockById.get(id)?.size ?? 1, fact,
    items, anyItem, optionalItems, liquidsAccepted, liquidsRequired,
    powerUse, powerMake, hasPower, consumesPower, outputsPower,
    rotates: data.rotate.includes(id),
    laserRange: fact.laserRange ?? 0, maxNodes: fact.maxNodes ?? 0, beamRange: isBeam ? fact.range ?? 0 : 0,
    turret, generator, factory, reconstructor,
    isDumper: dumpers.has(kind),
  };
  descriptorCache.set(id, descriptor);
  return descriptor;
}

export function blockKind(id) { return describeBlock(id).kind; }
export function isItemBelt(id) { return itemBelts.has(blockKind(id)); }
export function acceptsAmmo(turretId, item) { return Boolean(data.turrets[turretId]?.ammo.includes(item)); }
export function turretInfo(id) { return data.turrets[id] ?? null; }
export function generatorInfo(id) { return data.generators[id] ?? null; }
export function unitFactoryInfo(id) { return data.unitFactories[id] ?? null; }
export function reconstructorInfo(id) { return data.reconstructors[id] ?? null; }
export function assemblerInfo(id) { return data.assemblers[id] ?? null; }
export function itemProperties(id) { return data.items[id] ?? null; }
export function drillInfo(id) { return data.drills[id] ?? null; }
export function rotatesBlock(id) { return data.rotate.includes(id); }

const liquidById = new Map(liquidEntries.map(entry => [entry.id, entry]));
/** The plan a factory builds: the configured index, or the only plan of a non-configurable fabricator. */
function factoryPlan(info, tile) {
  const plans = info.factory?.plans ?? [];
  if (Number.isInteger(tile.config)) return plans[tile.config] ?? null;
  return plans.length === 1 ? plans[0] : null;
}

const label = id => blockById.get(id)?.name ?? itemById.get(id)?.name ?? id;
const liquidLabel = id => liquidById.get(id)?.name ?? itemById.get(id)?.name ?? id;
const itemLabel = id => id === WILDCARD ? 'любой предмет' : itemById.get(id)?.name ?? id;
const where = tile => `(${tile.x}, ${tile.y})`;

function configItem(tile) {
  const config = tile.config;
  if (config && config.type === 'content' && config.contentType === 'item') return config.id;
  return null;
}

function configPoint(tile) {
  const config = tile.config;
  if (config && config.type === 'point2') return { x: config.x, y: config.y };
  return null;
}

/** Build lookup tables for a scheme once; every analysis below shares them. */
function buildContext(scheme) {
  const tiles = scheme.tiles;
  const info = tiles.map(tile => describeBlock(tile.id));
  const rects = tiles.map(footprint);
  const cellIndex = new Map();
  rects.forEach((rect, index) => rectCells(rect).forEach(cell => cellIndex.set(cellKey(cell.x, cell.y), index)));
  const at = (x, y) => cellIndex.get(cellKey(x, y)) ?? -1;
  const neighbors = rects.map((rect, index) => {
    const seen = new Set();
    const list = [];
    for (const cell of ringCells(rect)) {
      const other = at(cell.x, cell.y);
      if (other < 0 || other === index || seen.has(other)) continue;
      seen.add(other);
      list.push({ index: other, side: cell.side });
    }
    return list;
  });
  return { scheme, tiles, info, rects, cellIndex, at, neighbors };
}

const frontIndex = (ctx, index) => {
  const tile = ctx.tiles[index];
  const dir = DIRS[((tile.rotation % 4) + 4) % 4];
  const rect = ctx.rects[index];
  // Conveyors are 1x1; for larger rotating blocks the front is the cell beyond the middle of the face.
  const mid = Math.floor((rect.size - 1) / 2);
  if (dir.x === 1) return ctx.at(rect.endX + 1, rect.startY + mid);
  if (dir.x === -1) return ctx.at(rect.startX - 1, rect.startY + mid);
  if (dir.y === 1) return ctx.at(rect.startX + mid, rect.endY + 1);
  return ctx.at(rect.startX + mid, rect.startY - 1);
};

const backIndex = (ctx, index) => {
  const tile = ctx.tiles[index];
  const dir = DIRS[((tile.rotation + 2) % 4 + 4) % 4];
  return ctx.at(tile.x + dir.x, tile.y + dir.y);
};

/** Direction (0..3) in which `to` lies as seen from `from`, using the facing edge for multi-tile blocks. */
function relativeDir(ctx, from, to) {
  const a = ctx.rects[from];
  const b = ctx.rects[to];
  if (b.startX > a.endX) return 0;
  if (b.endX < a.startX) return 2;
  if (b.startY > a.endY) return 1;
  if (b.endY < a.startY) return 3;
  return -1;
}

function bridgeTarget(ctx, index) {
  const tile = ctx.tiles[index];
  const info = ctx.info[index];
  if (info.kind === 'bridge' || info.kind === 'liquidBridge') {
    const point = configPoint(tile);
    if (!point) return -1;
    const target = ctx.at(tile.x + point.x, tile.y + point.y);
    return target >= 0 && target !== index && ctx.info[target].kind === info.kind ? target : -1;
  }
  if (info.kind === 'ductBridge') {
    const dir = DIRS[tile.rotation % 4];
    for (let step = 1; step <= 4; step += 1) {
      const other = ctx.at(tile.x + dir.x * step, tile.y + dir.y * step);
      if (other >= 0 && ctx.info[other].kind === 'ductBridge') return other;
    }
  }
  return -1;
}

function bridgeSources(ctx, index) {
  const sources = [];
  ctx.tiles.forEach((tile, other) => { if (other !== index && bridgeTarget(ctx, other) === index) sources.push(other); });
  return sources;
}

/** Does the building at `dest` take `item` coming from the building `src`? Mirrors each block's acceptItem. */
function accepts(ctx, dest, item, src) {
  const tile = ctx.tiles[dest];
  const info = ctx.info[dest];
  const srcInfo = src >= 0 ? ctx.info[src] : null;
  const any = item === WILDCARD;
  switch (info.kind) {
    case 'belt': case 'stack': {
      const front = frontIndex(ctx, dest);
      if (src >= 0 && front === src) return false;
      return true;
    }
    case 'armored': {
      const back = backIndex(ctx, dest);
      if (src === back) return true;
      return Boolean(srcInfo && (srcInfo.kind === 'belt' || srcInfo.kind === 'armored') && frontIndex(ctx, src) === dest);
    }
    case 'junction': {
      const dir = relativeDir(ctx, src, dest);
      if (dir < 0) return false;
      return ctx.at(tile.x + DIRS[dir].x, tile.y + DIRS[dir].y) >= 0;
    }
    case 'router': case 'sorter': case 'gate': case 'bridge': return true;
    case 'ductBridge': return bridgeTarget(ctx, dest) >= 0 && relativeDir(ctx, dest, src) !== tile.rotation;
    case 'ductRouter': case 'ductGate': return backIndex(ctx, dest) === src;
    case 'core': case 'storage': case 'launchPad': case 'incinerator': case 'cargoLoader': case 'driver': case 'accelerator': return true;
    case 'crafter': case 'turret': case 'generator': case 'reconstructor': return any || info.items.has(item);
    case 'unitFactory': {
      const plan = factoryPlan(info, tile);
      if (plan) return any || item in plan.cost;
      return any || info.items.has(item);
    }
    case 'assembler': case 'landingPad': return false;
    default: return false;
  }
}

/** Items a belt-like block can ever hand over: its front (or the block it feeds). */
function belts(ctx) {
  return ctx.info.map((info, index) => ({ info, index })).filter(entry => itemBelts.has(entry.info.kind));
}

/**
 * Propagate item types through the transport network.
 * Returns delivery tables plus every place where an item can get stuck.
 */
function propagateItems(ctx, goalItem) {
  const delivered = ctx.tiles.map(() => new Set());
  const carried = ctx.tiles.map(() => new Set());
  const stuck = [];
  const visited = new Set();
  const queue = [];
  const sources = [];

  const push = (dest, item, from) => {
    const key = `${dest}|${item}|${from}`;
    if (visited.has(key)) return;
    visited.add(key);
    queue.push({ index: dest, item, from });
  };
  const acceptors = (index, item, filter = () => true) => ctx.neighbors[index]
    .filter(n => filter(n) && accepts(ctx, n.index, item, index));

  // --- declared external inlets (lanes the player connects to supplies outside the blueprint) ---
  for (const inlet of ctx.scheme.inlets ?? []) {
    if (inlet.kind !== 'item') continue;
    const index = ctx.at(inlet.x, inlet.y);
    if (index < 0) continue;
    sources.push({ index, kind: 'inlet', item: inlet.id ?? WILDCARD, targets: 1 });
    push(index, inlet.id ?? WILDCARD, -1);
  }
  // --- drone logistics: a processor whose program takes an item from the core and drops it into link 0 ---
  ctx.tiles.forEach((tile, index) => {
    if (ctx.info[index].kind !== 'processor' || tile.config?.type !== 'logic') return;
    const code = tile.config.code ?? '';
    const item = /itemTake\s+\w+\s+@([\w-]+)/.exec(code)?.[1];
    if (!item || !/itemDrop/.test(code)) return;
    const link = tile.config.links?.[0];
    const target = link ? ctx.at(tile.x + link.x, tile.y + link.y) : -1;
    if (target < 0) return;
    sources.push({ index, kind: 'drone', item, targets: 1 });
    push(target, item, -1);
  });
  // --- sources ---
  ctx.tiles.forEach((tile, index) => {
    const info = ctx.info[index];
    if (info.kind === 'unloader') {
      const item = configItem(tile) ?? WILDCARD;
      const containers = ctx.neighbors[index].filter(n => ['core', 'storage'].includes(ctx.info[n.index].kind));
      const targets = ctx.neighbors[index].filter(n => !['core', 'storage'].includes(ctx.info[n.index].kind) && accepts(ctx, n.index, item, index));
      sources.push({ index, kind: 'unloader', item, containers: containers.length, targets: targets.length });
      if (containers.length) targets.forEach(n => push(n.index, item, index));
    } else if (info.kind === 'ductUnloader') {
      const item = configItem(tile) ?? WILDCARD;
      const back = backIndex(ctx, index);
      const front = frontIndex(ctx, index);
      const backKind = back >= 0 ? ctx.info[back].kind : null;
      const ok = back >= 0 && front >= 0 && backKind !== 'core' && ['storage', 'crafter', 'unitFactory'].includes(backKind);
      sources.push({ index, kind: 'ductUnloader', item, containers: ok ? 1 : 0, targets: front >= 0 && accepts(ctx, front, item, index) ? 1 : 0, backKind });
      if (ok && front >= 0 && accepts(ctx, front, item, index)) push(front, item, index);
    } else if (info.kind === 'drill') {
      const output = info.id.includes('cliff') ? 'sand' : goalItem ?? WILDCARD;
      const targets = acceptors(index, output);
      sources.push({ index, kind: 'drill', item: output, targets: targets.length });
      targets.forEach(n => push(n.index, output, index));
    } else if (info.kind === 'crafter' && info.fact.output) {
      for (const output of Object.keys(info.fact.output)) {
        const targets = acceptors(index, output);
        sources.push({ index, kind: 'crafter', item: output, targets: targets.length });
        targets.forEach(n => push(n.index, output, index));
      }
    } else if (info.kind === 'landingPad') {
      const item = configItem(tile) ?? WILDCARD;
      const targets = acceptors(index, item);
      sources.push({ index, kind: 'landingPad', item, targets: targets.length });
      targets.forEach(n => push(n.index, item, index));
    } else if (info.kind === 'cargoUnload') {
      const item = configItem(tile) ?? WILDCARD;
      const targets = acceptors(index, item);
      sources.push({ index, kind: 'cargoUnload', item, targets: targets.length });
      targets.forEach(n => push(n.index, item, index));
    }
  });

  // --- propagation ---
  const stuckAt = (index, item, reason, dest = -1) => stuck.push({ index, item, reason, dest });
  while (queue.length) {
    const { index, item, from } = queue.shift();
    const info = ctx.info[index];
    const tile = ctx.tiles[index];
    if (['core', 'storage', 'crafter', 'turret', 'generator', 'reconstructor', 'unitFactory', 'launchPad', 'incinerator', 'cargoLoader', 'driver', 'accelerator'].includes(info.kind)) {
      delivered[index].add(item);
      continue;
    }
    carried[index].add(item);
    switch (info.kind) {
      case 'belt': case 'armored': case 'stack': {
        const front = frontIndex(ctx, index);
        if (front < 0) stuckAt(index, item, 'void');
        else if (!accepts(ctx, front, item, index)) stuckAt(index, item, ctx.info[front].kind === 'belt' || ctx.info[front].kind === 'armored' ? 'head-on' : 'refused', front);
        else push(front, item, index);
        break;
      }
      case 'junction': {
        const dir = relativeDir(ctx, from, index);
        const next = dir < 0 ? -1 : ctx.at(tile.x + DIRS[dir].x, tile.y + DIRS[dir].y);
        if (next < 0) stuckAt(index, item, 'void');
        else if (!accepts(ctx, next, item, index)) stuckAt(index, item, 'refused', next);
        else push(next, item, index);
        break;
      }
      case 'router': {
        const outs = ctx.neighbors[index].filter(n => n.index !== from && accepts(ctx, n.index, item, index));
        if (!outs.length) stuckAt(index, item, 'refused');
        outs.forEach(n => push(n.index, item, index));
        break;
      }
      case 'ductRouter': {
        const back = backIndex(ctx, index);
        const outs = ctx.neighbors[index].filter(n => n.index !== back && accepts(ctx, n.index, item, index));
        if (!outs.length) stuckAt(index, item, 'refused');
        outs.forEach(n => push(n.index, item, index));
        break;
      }
      case 'sorter': {
        const dir = relativeDir(ctx, from, index);
        const sortItem = configItem(tile);
        const invert = tile.id === 'inverted-sorter';
        const matches = sortItem != null && (item === sortItem || item === WILDCARD);
        const forwardPass = item === WILDCARD ? true : (matches !== invert);
        const outs = [];
        if (dir >= 0) {
          const forward = ctx.at(tile.x + DIRS[dir].x, tile.y + DIRS[dir].y);
          if (forwardPass && forward >= 0 && accepts(ctx, forward, item, index)) outs.push(forward);
          if (!forwardPass || item === WILDCARD) {
            for (const side of [(dir + 1) % 4, (dir + 3) % 4]) {
              const other = ctx.at(tile.x + DIRS[side].x, tile.y + DIRS[side].y);
              if (other >= 0 && accepts(ctx, other, item, index)) outs.push(other);
            }
          }
        }
        if (!outs.length) stuckAt(index, item, 'refused');
        outs.forEach(next => push(next, item, index));
        break;
      }
      case 'gate': {
        const dir = relativeDir(ctx, from, index);
        const outs = [];
        if (dir >= 0) {
          for (const d of [dir, (dir + 1) % 4, (dir + 3) % 4]) {
            const other = ctx.at(tile.x + DIRS[d].x, tile.y + DIRS[d].y);
            if (other >= 0 && accepts(ctx, other, item, index)) outs.push(other);
          }
        }
        if (!outs.length) stuckAt(index, item, 'refused');
        outs.forEach(next => push(next, item, index));
        break;
      }
      case 'ductGate': {
        const back = backIndex(ctx, index);
        const outs = ctx.neighbors[index].filter(n => n.index !== back && accepts(ctx, n.index, item, index));
        if (!outs.length) stuckAt(index, item, 'refused');
        outs.forEach(n => push(n.index, item, index));
        break;
      }
      case 'bridge': case 'ductBridge': {
        const target = bridgeTarget(ctx, index);
        if (target >= 0) {
          push(target, item, index);
        } else {
          const incoming = bridgeSources(ctx, index).map(source => relativeDir(ctx, index, source));
          const outs = ctx.neighbors[index].filter(n => {
            if (info.kind === 'ductBridge') return n.side === tile.rotation && accepts(ctx, n.index, item, index);
            return !incoming.includes(n.side) && accepts(ctx, n.index, item, index);
          });
          if (!outs.length) stuckAt(index, item, 'refused');
          outs.forEach(n => push(n.index, item, index));
        }
        break;
      }
      default:
        stuckAt(index, item, 'refused');
    }
  }
  return { delivered, carried, stuck, sources };
}

function describeStuck(ctx, group) {
  const tile = ctx.tiles[group.index];
  const items = [...group.items].map(itemLabel).join(', ');
  const next = group.dest >= 0 ? ctx.tiles[group.dest] : null;
  if (group.reason === 'void') return `${label(tile.id)} ${where(tile)} упирается в пустоту: предмет «${items}» дальше не пойдёт.`;
  if (group.reason === 'head-on') return `${label(tile.id)} ${where(tile)} направлен навстречу соседней ленте ${where(next)}: предмет «${items}» застрянет.`;
  if (next) return `${label(tile.id)} ${where(tile)}: «${label(next.id)}» ${where(next)} не принимает «${items}» — линия остановится.`;
  return `${label(tile.id)} ${where(tile)}: нет приёмника для «${items}».`;
}

/**
 * Union-find over power buildings; mirrors proximity conduction and node auto-linking.
 * Returns the graph plus the laser links each node would form (used to write explicit node configs).
 */
function buildPowerNetwork(ctx) {
  const n = ctx.tiles.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  const powered = ctx.info.map(info => info.hasPower);
  const nodeLinks = new Map();
  if (!powered.some(Boolean)) return { find, powered, nodeLinks, links: [] };

  const conducts = (a, b) => {
    const ia = ctx.info[a];
    const ib = ctx.info[b];
    if (!ia.hasPower || !ib.hasPower) return false;
    return !(ia.consumesPower && ib.consumesPower && !ia.outputsPower && !ib.outputsPower);
  };
  ctx.tiles.forEach((_, a) => {
    if (!powered[a]) return;
    ctx.neighbors[a].forEach(({ index: b }) => { if (b > a && powered[b] && conducts(a, b)) union(a, b); });
  });

  const linkedCount = new Array(n).fill(0);
  const links = [];
  const connect = (a, b) => {
    if (find(a) !== find(b)) union(a, b);
    links.push([a, b]);
    linkedCount[a] += 1;
    linkedCount[b] += 1;
    if (!nodeLinks.has(a)) nodeLinks.set(a, []);
    nodeLinks.get(a).push(b);
  };
  const explicitLinks = index => {
    const config = ctx.tiles[index].config;
    if (!config || config.type !== 'point2[]') return null;
    return config.points.map(point => ctx.at(ctx.tiles[index].x + point.x, ctx.tiles[index].y + point.y)).filter(target => target >= 0 && target !== index);
  };
  // Mindustry builds nodes after every other block (schematicPriority < 0); each node links to one building per distinct graph in range.
  const nodeOrder = ctx.tiles.map((_, index) => index).filter(index => ['node', 'beam'].includes(ctx.info[index].kind));
  for (const index of nodeOrder) {
    const info = ctx.info[index];
    const rect = ctx.rects[index];
    const center = rectCenter(rect);
    if (info.kind === 'beam') {
      DIRS.forEach((dir, d) => {
        for (let step = 1; step <= info.beamRange + Math.floor(rect.size / 2); step += 1) {
          const x = d === 0 ? rect.endX + step : d === 2 ? rect.startX - step : Math.round(center.x);
          const y = d === 1 ? rect.endY + step : d === 3 ? rect.startY - step : Math.round(center.y);
          const other = ctx.at(x, y);
          if (other >= 0 && other !== index && ctx.info[other].hasPower) {
            if (find(other) !== find(index)) connect(index, other);
            break;
          }
        }
      });
      continue;
    }
    const explicit = explicitLinks(index);
    if (explicit?.length) {
      for (const target of explicit) if (powered[target]) connect(index, target);
      continue;
    }
    const seen = new Set([find(index)]);
    ctx.neighbors[index].forEach(({ index: adjacent }) => { if (powered[adjacent]) seen.add(find(adjacent)); });
    const candidates = [];
    ctx.tiles.forEach((_, other) => {
      if (other === index || !powered[other]) return;
      const otherInfo = ctx.info[other];
      if (!(otherInfo.outputsPower || otherInfo.consumesPower || otherInfo.kind === 'node')) return;
      if (ctx.neighbors[index].some(neighbor => neighbor.index === other)) return;
      const distance = distanceToRect(center.x, center.y, ctx.rects[other]);
      const otherCenter = rectCenter(ctx.rects[other]);
      const reverse = otherInfo.kind === 'node' && distanceToRect(otherCenter.x, otherCenter.y, rect) <= otherInfo.laserRange;
      if (distance <= info.laserRange || reverse) candidates.push({ other, distance });
    });
    candidates.sort((a, b) => a.distance - b.distance);
    for (const { other } of candidates) {
      if (linkedCount[index] >= info.maxNodes) break;
      if (ctx.info[other].kind === 'node' && linkedCount[other] >= ctx.info[other].maxNodes) continue;
      if (seen.has(find(other))) continue;
      seen.add(find(other));
      connect(index, other);
    }
  }
  return { find, powered, nodeLinks, links };
}

function analyzePower(ctx, issues) {
  const net = buildPowerNetwork(ctx);
  const inletRoots = new Set((ctx.scheme.inlets ?? []).filter(inlet => inlet.kind === 'power').map(inlet => ctx.at(inlet.x, inlet.y)).filter(index => index >= 0).map(index => net.find(index)));
  if (!net.powered.some(Boolean)) return { generation: 0, demand: 0, islands: 0, links: 0 };
  const groups = new Map();
  ctx.tiles.forEach((_, index) => {
    if (!net.powered[index]) return;
    const root = net.find(index);
    if (!groups.has(root)) groups.set(root, { members: [], make: 0, use: 0, hasNode: false, external: inletRoots.has(root) });
    const group = groups.get(root);
    group.members.push(index);
    const info = ctx.info[index];
    group.make += info.powerMake;
    if (['node', 'beam'].includes(info.kind)) group.hasNode = true;
    if (info.powerUse > 0 && info.kind !== 'battery') group.use += info.powerUse;
  });
  let generation = 0;
  let demand = 0;
  for (const group of groups.values()) {
    generation += group.make;
    demand += group.use;
    const consumers = group.members.filter(index => ctx.info[index].powerUse > 0 && !['battery', 'beam'].includes(ctx.info[index].kind));
    if (!consumers.length) continue;
    if (group.make <= 0) {
      const tile = ctx.tiles[consumers[0]];
      // A network that already ends in a power node is an intentional external input; an isolated consumer is a mistake.
      if (group.external) {
        issues.push({ level: 'info', code: 'power-external', x: tile.x, y: tile.y, text: `Сеть с «${label(tile.id)}» ${where(tile)}: подключи внешний источник к силовому узлу (нужно ${Math.round(group.use)} ед./с).` });
      } else if (group.hasNode) {
        issues.push({ level: 'warn', code: 'power-external', x: tile.x, y: tile.y, text: `Сеть с «${label(tile.id)}» ${where(tile)} без генератора: подключи внешний источник к силовому узлу (нужно ${Math.round(group.use)} ед./с).` });
      } else {
        // Power switched off in the settings is a deliberate "bring your own grid", not a design fault.
        const optedOut = ctx.scheme.settings?.includePower === false;
        for (const index of consumers.slice(0, 6)) {
          const lone = ctx.tiles[index];
          issues.push({
            level: optedOut ? 'warn' : 'error', code: 'power-source', x: lone.x, y: lone.y,
            text: `${label(lone.id)} ${where(lone)} не подключён к энергосети: ${optedOut ? 'питание отключено в настройках — подведи внешнюю сеть' : 'рядом нет генератора или силового узла'}.`,
          });
        }
      }
    } else if (group.make < group.use * 0.999) {
      const tile = ctx.tiles[consumers[0]];
      issues.push({ level: 'warn', code: 'power-deficit', x: tile.x, y: tile.y, text: `В сети рядом с «${label(tile.id)}» ${where(tile)} не хватает энергии: нужно ${Math.round(group.use)} ед./с, вырабатывается ${Math.round(group.make)} ед./с.` });
    }
  }
  return { generation, demand, links: net.links.length, islands: groups.size };
}

/** For generators: which buildings would each power node link to? Returns [{ node, targets }] over `tiles` indices. */
export function powerNodeLinks(tiles) {
  const ctx = buildContext({ tiles });
  const net = buildPowerNetwork(ctx);
  return [...net.nodeLinks].map(([node, targets]) => ({ node: tiles[node], targets: targets.map(target => tiles[target]) }));
}

/** Components of the power graph (indices of tiles), used by the planner to decide where nodes are still needed. */
export function powerComponents(tiles) {
  const ctx = buildContext({ tiles });
  const net = buildPowerNetwork(ctx);
  const groups = new Map();
  tiles.forEach((tile, index) => {
    if (!net.powered[index]) return;
    const root = net.find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(tile);
  });
  return [...groups.values()];
}

/** Liquid propagation: pumps and liquid crafters → conduits → consumers. */
function analyzeLiquids(ctx, issues) {
  const needers = ctx.info.map((info, index) => ({ info, index })).filter(({ info }) => Object.keys(info.liquidsRequired).length);
  if (!needers.length) return;
  const reached = ctx.tiles.map(() => new Set());
  const visited = new Set();
  const queue = [];
  const push = (index, liquid, from) => {
    const key = `${index}|${liquid}|${from}`;
    if (visited.has(key)) return;
    visited.add(key);
    queue.push({ index, liquid, from });
  };
  const liquidAcceptor = (index, liquid, src) => {
    const info = ctx.info[index];
    switch (info.kind) {
      case 'conduit': {
        const front = frontIndex(ctx, index);
        return !(src >= 0 && front === src);
      }
      case 'armoredConduit': {
        const back = backIndex(ctx, index);
        return src === back || ctx.info[src]?.kind === 'conduit' || ctx.info[src]?.kind === 'armoredConduit';
      }
      case 'liquidRouter': case 'liquidBridge': case 'liquidJunction': return true;
      default:
        return liquid === WILDCARD ? info.liquidsAccepted.size > 0 : info.liquidsAccepted.has(liquid);
    }
  };
  for (const inlet of ctx.scheme.inlets ?? []) {
    if (inlet.kind !== 'liquid') continue;
    const index = ctx.at(inlet.x, inlet.y);
    if (index >= 0) push(index, inlet.id ?? WILDCARD, -1);
  }
  ctx.tiles.forEach((tile, index) => {
    const info = ctx.info[index];
    const outputs = [];
    if (info.kind === 'pump') outputs.push(tile.id === 'water-extractor' ? 'water' : WILDCARD);
    if (tile.id === 'oil-extractor') outputs.push('oil');
    if (info.fact.outputLiquids) outputs.push(...Object.keys(info.fact.outputLiquids));
    if (info.kind === 'liquidRouter' && /container|tank/.test(tile.id)) return;
    for (const liquid of outputs) {
      ctx.neighbors[index].forEach(n => { if (liquidAcceptor(n.index, liquid, index)) push(n.index, liquid, index); });
    }
  });
  while (queue.length) {
    const { index, liquid, from } = queue.shift();
    const info = ctx.info[index];
    const tile = ctx.tiles[index];
    if (!['conduit', 'armoredConduit', 'liquidRouter', 'liquidBridge', 'liquidJunction'].includes(info.kind)) {
      reached[index].add(liquid);
      continue;
    }
    reached[index].add(liquid);
    if (info.kind === 'conduit' || info.kind === 'armoredConduit') {
      const front = frontIndex(ctx, index);
      if (front >= 0 && liquidAcceptor(front, liquid, index)) push(front, liquid, index);
    } else if (info.kind === 'liquidJunction') {
      const dir = relativeDir(ctx, from, index);
      const next = dir < 0 ? -1 : ctx.at(tile.x + DIRS[dir].x, tile.y + DIRS[dir].y);
      if (next >= 0 && liquidAcceptor(next, liquid, index)) push(next, liquid, index);
    } else if (info.kind === 'liquidBridge') {
      const target = bridgeTarget(ctx, index);
      if (target >= 0) push(target, liquid, index);
      else ctx.neighbors[index].forEach(n => { if (n.index !== from && liquidAcceptor(n.index, liquid, index)) push(n.index, liquid, index); });
    } else {
      ctx.neighbors[index].forEach(n => { if (n.index !== from && liquidAcceptor(n.index, liquid, index)) push(n.index, liquid, index); });
    }
  }
  for (const { info, index } of needers) {
    const tile = ctx.tiles[index];
    for (const liquid of Object.keys(info.liquidsRequired)) {
      const choices = liquid.startsWith('ammo:') ? liquid.slice(5).split('|') : [liquid];
      const ok = choices.some(choice => reached[index].has(choice) || reached[index].has(WILDCARD));
      if (!ok) {
        const names = choices.map(liquidLabel).join(' / ');
        issues.push({ level: 'warn', code: 'liquid-missing', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)}: жидкость «${names}» не подведена — добавь насос/трубу или соседний источник.` });
      }
    }
  }
}

/**
 * Analyse a scheme. Returns `{ issues, errors, warnings, power, items }`.
 * Levels: `error` = the design cannot work as drawn, `warn` = likely to underperform or needs outside input.
 */
export function analyzeFlow(scheme, options = {}) {
  const issues = [];
  const tiles = scheme.tiles ?? [];
  if (!tiles.length) return { issues, errors: 0, warnings: 0, power: { generation: 0, demand: 0 }, items: {} };
  const ctx = buildContext(scheme);
  const goal = scheme.settings?.direction === 'mining' ? scheme.settings.goal : null;
  const flows = propagateItems(ctx, goal);

  // Structural belt checks: a belt that points at nothing never moves items, whatever is upstream.
  const reportedBelts = new Set();
  const outletCells = new Set((scheme.outlets ?? []).map(outlet => cellKey(outlet.x, outlet.y)));
  for (const { info, index } of belts(ctx)) {
    const tile = ctx.tiles[index];
    const front = frontIndex(ctx, index);
    if (front < 0 && outletCells.has(cellKey(tile.x, tile.y))) continue;
    if (front < 0) {
      reportedBelts.add(index);
      issues.push({ level: 'error', code: 'belt-void', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)} направлен в пустую клетку — лента ни во что не упирается.` });
    } else if (!ctx.info[front].anyItem && !['belt', 'armored', 'stack', 'junction', 'router', 'sorter', 'gate', 'bridge', 'ductBridge', 'ductRouter', 'ductGate', 'crafter', 'turret', 'generator', 'reconstructor', 'unitFactory'].includes(ctx.info[front].kind)) {
      reportedBelts.add(index);
      issues.push({ level: 'error', code: 'belt-blocked', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)} направлен в «${label(ctx.tiles[front].id)}», который не принимает предметы.` });
    } else if (['belt', 'armored'].includes(ctx.info[front].kind) && frontIndex(ctx, front) === index) {
      reportedBelts.add(index);
      issues.push({ level: 'error', code: 'belt-head-on', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)} и соседняя лента ${where(ctx.tiles[front])} направлены друг на друга — предметы не пройдут.` });
    }
  }

  // Jams discovered by following real item flows.
  const grouped = new Map();
  for (const entry of flows.stuck) {
    if (reportedBelts.has(entry.index)) continue;
    if (entry.reason === 'void' && outletCells.has(cellKey(ctx.tiles[entry.index].x, ctx.tiles[entry.index].y))) continue;
    const key = `${entry.index}|${entry.reason}|${entry.dest}`;
    if (!grouped.has(key)) grouped.set(key, { ...entry, items: new Set() });
    grouped.get(key).items.add(entry.item);
  }
  for (const group of grouped.values()) {
    const tile = ctx.tiles[group.index];
    issues.push({ level: group.reason === 'refused' && ctx.info[group.index].kind !== 'belt' ? 'warn' : 'error', code: 'item-stuck', x: tile.x, y: tile.y, text: describeStuck(ctx, group) });
  }

  // Sources must have somewhere to put their items.
  for (const source of flows.sources) {
    const tile = ctx.tiles[source.index];
    if (source.kind === 'unloader') {
      if (!source.containers) issues.push({ level: 'error', code: 'unloader-empty', x: tile.x, y: tile.y, text: `Разгрузчик ${where(tile)} не касается ядра или склада — ему нечего выгружать.` });
      else if (!source.targets) issues.push({ level: 'error', code: 'unloader-idle', x: tile.x, y: tile.y, text: `Разгрузчик ${where(tile)} ни с чем не соединён: рядом нет ленты или блока, принимающего «${itemLabel(source.item)}».` });
      if (source.item === WILDCARD) issues.push({ level: 'warn', code: 'unloader-filter', x: tile.x, y: tile.y, text: `Разгрузчик ${where(tile)} без фильтра выгружает все предметы подряд — выбери конкретный.` });
    } else if (source.kind === 'ductUnloader') {
      if (source.backKind === 'core') issues.push({ level: 'error', code: 'duct-unloader-core', x: tile.x, y: tile.y, text: `Канальный разгрузчик ${where(tile)} стоит у ядра: на Эрекире ядро нельзя разгружать напрямую — нужен отдельный контейнер.` });
      else if (!source.containers) issues.push({ level: 'error', code: 'unloader-empty', x: tile.x, y: tile.y, text: `Канальный разгрузчик ${where(tile)} должен стоять спиной к контейнеру, а лицом — к приёмнику.` });
      else if (!source.targets) issues.push({ level: 'error', code: 'unloader-idle', x: tile.x, y: tile.y, text: `Канальный разгрузчик ${where(tile)} смотрит в блок, который не принимает «${itemLabel(source.item)}».` });
    } else if (source.kind === 'crafter' && !source.targets) {
      issues.push({ level: 'error', code: 'output-unrouted', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)}: выход «${itemLabel(source.item)}» никуда не отведён — рядом нет ленты, ядра или склада, которые его примут.` });
    } else if (source.kind === 'landingPad' && !source.targets) {
      issues.push({ level: 'warn', code: 'landing-idle', x: tile.x, y: tile.y, text: `Посадочная площадка ${where(tile)} не подаёт «${itemLabel(source.item)}»: рядом нет приёмника.` });
    }
  }

  // Consumers must receive everything their recipe needs.
  ctx.tiles.forEach((tile, index) => {
    const info = ctx.info[index];
    const got = flows.delivered[index];
    const hasAll = item => got.has(item) || got.has(WILDCARD);
    if (info.kind === 'crafter' && info.fact.output && info.fact.craftTime) {
      for (const item of Object.keys(info.fact.inputs ?? {})) {
        if (info.optionalItems.has(item)) continue;
        if (!hasAll(item)) issues.push({ level: 'error', code: 'input-missing', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)}: не приходит «${itemLabel(item)}» — нет ленты или разгрузчика с этим предметом.` });
      }
      // Output must end in something that stores or consumes it.
      for (const output of Object.keys(info.fact.output)) {
        const sinks = ctx.tiles.some((_, other) => other !== index && flows.delivered[other].has(output) && (ctx.info[other].anyItem || ctx.info[other].items.has(output)));
        if (!sinks && flows.sources.some(source => source.index === index && source.item === output && source.targets)) {
          issues.push({ level: 'warn', code: 'output-lost', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)}: «${itemLabel(output)}» не доходит ни до ядра, ни до склада.` });
        }
      }
    }
    if (info.kind === 'turret' && info.turret?.class === 'ItemTurret' && ![...got].some(item => item === WILDCARD || info.turret.ammo.includes(item))) {
      issues.push({ level: 'error', code: 'ammo-missing', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)} без боеприпасов: подведи ${info.turret.ammo.map(itemLabel).join(' / ')}.` });
    }
    if (info.kind === 'generator' && info.generator?.fuel) {
      if (![...got].some(item => item === WILDCARD || info.items.has(item))) {
        issues.push({ level: 'error', code: 'fuel-missing', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)} без топлива: подведи ${[...info.items].slice(0, 3).map(itemLabel).join(' / ')}.` });
      }
    }
    if (info.kind === 'unitFactory') {
      const plan = factoryPlan(info, tile);
      if (!plan) issues.push({ level: 'warn', code: 'factory-plan', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)}: не выбран план производства юнита.` });
      else for (const item of Object.keys(plan.cost)) if (!hasAll(item)) issues.push({ level: 'error', code: 'input-missing', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)}: для юнита «${plan.unit}» не приходит «${itemLabel(item)}».` });
    }
    if (info.kind === 'reconstructor') {
      for (const item of Object.keys(info.reconstructor?.cost ?? {})) if (!hasAll(item)) issues.push({ level: 'error', code: 'input-missing', x: tile.x, y: tile.y, text: `${label(tile.id)} ${where(tile)}: не приходит «${itemLabel(item)}» для улучшения юнитов.` });
    }
  });

  const power = analyzePower(ctx, issues);
  analyzeLiquids(ctx, issues);

  const unique = [];
  const seen = new Set();
  for (const issue of issues) {
    const key = `${issue.code}|${issue.x}|${issue.y}|${issue.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  const errors = unique.filter(issue => issue.level === 'error').length;
  const warnings = unique.filter(issue => issue.level === 'warn').length;
  const infos = unique.filter(issue => issue.level === 'info').length;
  const items = Object.fromEntries(ctx.tiles.map((tile, index) => [`${tile.x},${tile.y}`, [...flows.delivered[index]]]).filter(([, list]) => list.length));
  return { issues: unique, errors, warnings, infos, power, items, delivered: options.keepDelivered ? flows.delivered : undefined, context: options.keepContext ? ctx : undefined };
}

export { WILDCARD };
