import { blockById, campaignBlockById, itemById } from '../catalog.js';
import facts from '../block-facts.json' with { type: 'json' };
import { describeBlock, drillInfo, itemProperties } from '../flow.js';

export const stageRank = { early: 0, mid: 1, late: 2 };
export const stageTier = stage => stageRank[stage] ?? 1;

/** What each planet's logistics look like. Ducts replace belts on Erekir and there is no junction. */
export const PROFILES = {
  serpulo: {
    id: 'serpulo',
    belts: [{ id: 'conveyor', rate: 4.2 }, { id: 'titanium-conveyor', rate: 11 }],
    conduits: [{ id: 'conduit', rate: 8 }, { id: 'pulse-conduit', rate: 16 }],
    junction: 'junction', liquidJunction: 'liquid-junction', liquidRouter: 'liquid-router', router: 'router', gate: 'underflow-gate', sorter: 'sorter',
    unloader: 'unloader', node: 'power-node', largeNode: 'power-node-large', battery: 'battery', wall: 'copper-wall',
    cores: ['core-shard', 'core-foundation', 'core-nucleus'], coreUnloadable: true, defaultAmmo: 'graphite', baseItem: 'copper',
    // Jumps a lane can make instead of going around: a cheap short bridge and an expensive long phase link.
    itemJumps: [
      { id: 'bridge-conveyor', range: 4, cost: 1.8, phase: false },
      { id: 'phase-conveyor', range: 12, cost: 3.2, phase: true },
    ],
    liquidJumps: [
      { id: 'bridge-conduit', range: 4, cost: 1.8, phase: false },
      { id: 'phase-conduit', range: 12, cost: 3.2, phase: true },
    ],
    // A gate that feeds its sides first and only then lets items through: the right block for a spine
    // with consumers hanging off it. `overflow` is the mirror image — front first, sides when blocked.
    spineGate: 'underflow-gate', overflowGate: 'overflow-gate',
  },
  erekir: {
    id: 'erekir',
    belts: [{ id: 'duct', rate: 15 }],
    conduits: [{ id: 'reinforced-conduit', rate: 12 }],
    junction: null, liquidJunction: 'reinforced-liquid-junction', liquidRouter: 'reinforced-liquid-router', router: 'duct-router', gate: 'underflow-duct', sorter: null,
    unloader: 'duct-unloader', node: 'beam-node', largeNode: 'beam-tower', battery: 'beam-node', wall: 'beryllium-wall',
    cores: ['core-bastion', 'core-citadel', 'core-acropolis'], coreUnloadable: false, defaultAmmo: 'beryllium', baseItem: 'beryllium',
    itemJumps: [{ id: 'duct-bridge', range: 4, cost: 1.8, phase: false }],
    liquidJumps: [{ id: 'reinforced-bridge-conduit', range: 4, cost: 1.8, phase: false }],
    spineGate: 'underflow-duct', overflowGate: 'overflow-duct',
  },
};

/**
 * Jump blocks a lane may use on this planet, filtered by what the player allowed.
 * `allowPhase` gates the endgame links (they cost phase fabric and draw power); bridges are always cheap.
 */
export function laneJumps(planet, kind = 'item', { allowPhase = false, bridges = true } = {}) {
  const profile = profileFor(planet);
  const list = kind === 'liquid' ? profile.liquidJumps : profile.itemJumps;
  return (list ?? []).filter(entry => (entry.phase ? allowPhase : bridges) && availableOn(entry.id, planet));
}

export const profileFor = planet => PROFILES[planet] ?? PROFILES.serpulo;

const serpuloTiers = {
  copper: 0, lead: 0, scrap: 0, sand: 0, coal: 0, graphite: 1, silicon: 1, metaglass: 1, titanium: 1,
  'spore-pod': 1, pyratite: 1, 'blast-compound': 2, plastanium: 2, thorium: 2, 'phase-fabric': 2, 'surge-alloy': 2,
};
const erekirTiers = {
  beryllium: 0, graphite: 0, silicon: 0, sand: 0, tungsten: 1, oxide: 1, carbide: 2, thorium: 2,
  'phase-fabric': 2, 'surge-alloy': 2, copper: 0, lead: 0, titanium: 1, metaglass: 1, scrap: 0, coal: 0,
};

/** Technology tier of a block from the materials it costs (0 = starter, 1 = developed, 2 = endgame). */
export function techTier(id, planet = 'serpulo') {
  const cost = facts[id]?.cost;
  if (!cost) return 0;
  const tiers = planet === 'erekir' ? erekirTiers : serpuloTiers;
  return Math.max(0, ...Object.keys(cost).map(item => tiers[item] ?? 1));
}

export function availableOn(id, planet) {
  const block = campaignBlockById.get(id);
  return Boolean(block && (block.planet === 'both' || block.planet === planet));
}

/** First candidate that exists on the planet and fits the stage; otherwise the first that exists at all. */
export function pickBlock(planet, stage, candidates) {
  const existing = candidates.filter(id => id && availableOn(id, planet));
  return existing.find(id => techTier(id, planet) <= stageTier(stage)) ?? existing[0] ?? null;
}

/** Cheapest belt type that carries `rate` items/s (basic conveyors are skipped when the stage allows better). */
export function chooseBelt(planet, stage, rate) {
  const belts = profileFor(planet).belts.filter(entry => availableOn(entry.id, planet));
  const tiered = belts.filter(entry => techTier(entry.id, planet) <= stageTier(stage));
  const pool = tiered.length ? tiered : belts;
  return (pool.find(entry => entry.rate >= rate) ?? belts.find(entry => entry.rate >= rate) ?? belts.at(-1)).id;
}

export function beltRate(planet, id) {
  return profileFor(planet).belts.find(entry => entry.id === id)?.rate ?? 4.2;
}

export function coreIdFor(planet, stage) {
  const cores = profileFor(planet).cores;
  return cores[Math.min(cores.length - 1, stageTier(stage))];
}

/** Ore hardness from the item table (sand 0, copper 1, coal 2, titanium 3...). */
export function hardnessOf(item) { return itemProperties(item)?.hardness ?? 0; }

/** Mindustry's drill formula: 60 / (drillTime + 50 * hardness) items/s per ore tile. */
export function drillRatePerTile(drillId, item) {
  const fact = facts[drillId];
  const info = drillInfo(drillId);
  if (!fact || !info) return 0;
  const drillTime = info.drillTime ?? fact.drillTime;
  if (!drillTime) return 0;
  if (info.class === 'BurstDrill') {
    // Burst drills mine 4 or 5 tiles' worth per cycle: the time already includes the hardness multiplier.
    return 60 / (drillTime + 50 * hardnessOf(item)) * (item === 'beryllium' ? 2 : 1);
  }
  if (info.class === 'BeamDrill') return 60 / (drillTime + 50 * hardnessOf(item));
  if (info.class === 'WallCrafter') return 60 / drillTime;
  return 60 / (drillTime + 50 * hardnessOf(item));
}

export function drillRate(drillId, item) {
  const info = drillInfo(drillId);
  const size = blockById.get(drillId)?.size ?? 2;
  const perTile = drillRatePerTile(drillId, item);
  if (info?.class === 'BeamDrill') return perTile * size; // one beam per tile of width
  if (info?.class === 'WallCrafter') return perTile * size;
  return perTile * size * size;
}

/** Drills able to mine an item on this planet, strongest first. */
export function drillsFor(planet, item) {
  const hardness = hardnessOf(item);
  return Object.entries(describeAllDrills())
    .filter(([id, info]) => availableOn(id, planet) && drillMines(id, info, item, hardness, planet))
    .map(([id]) => id);
}

function describeAllDrills() {
  return Object.fromEntries(Object.keys(facts).filter(id => drillInfo(id)).map(id => [id, drillInfo(id)]));
}

function drillMines(id, info, item, hardness, planet) {
  if (info.blocked === item) return false;
  if (info.class === 'WallCrafter') return info.output === item;
  const tier = info.tier ?? facts[id]?.tier ?? 0;
  if (planet === 'erekir') {
    // Erekir ore: beryllium/tungsten/thorium/graphite are wall or floor ores; sand needs a crusher or a drill on sand.
    if (item === 'sand') return info.class === 'WallCrafter';
    if (!['beryllium', 'tungsten', 'thorium', 'graphite'].includes(item)) return false;
    // Graphite only exists as wall ore, which only beam drills can reach.
    if (item === 'graphite') return info.class === 'BeamDrill';
    return info.class !== 'Drill' && tier >= hardness;
  }
  if (info.class !== 'Drill') return false;
  return tier >= hardness;
}

/** Items that can be mined from the ground of a planet (as opposed to being manufactured). */
export function rawItems(planet) {
  return planet === 'erekir'
    ? ['beryllium', 'tungsten', 'thorium', 'graphite', 'sand']
    : ['copper', 'lead', 'sand', 'coal', 'scrap', 'titanium', 'thorium'];
}

export function itemName(id) { return itemById.get(id)?.name ?? id; }
export function blockName(id) { return blockById.get(id)?.name ?? id; }
export function powerOf(id) { return describeBlock(id).powerUse; }
