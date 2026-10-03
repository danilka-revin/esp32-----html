/**
 * "I want N per second" → a concrete number of machines.
 *
 * Every direction used to size itself from the canvas area alone, so the player could never ask for an
 * amount. This module keeps the arithmetic in one place: a builder computes what *one* block yields
 * (from the game data, never from a guess) and asks how many of them a target needs. When the canvas
 * cannot hold that many, the plan is clamped and the shortfall is reported instead of silently ignored.
 */
import { describeBlock, generatorInfo } from '../flow.js';

/**
 * What the target means for each direction. `perMinute` marks units whose slider is per minute
 * (a unit factory plan is quoted in seconds, but players think in units per minute).
 */
export const rateMeta = {
  mining: { label: 'Выход руды', unit: 'ед./с', noun: 'руды', min: 1, max: 120, step: 0.5, perMinute: false },
  production: { label: 'Выпуск продукта', unit: 'ед./с', noun: 'продукта', min: 0.5, max: 120, step: 0.5, perMinute: false },
  power: { label: 'Мощность', unit: 'ед./с', noun: 'энергии', min: 60, max: 6000, step: 30, perMinute: false },
  units: { label: 'Темп выпуска', unit: 'шт./мин', noun: 'юнитов', min: 1, max: 60, step: 1, perMinute: true },
  logistics: { label: 'Поток магистрали', unit: 'ед./с', noun: 'предметов', min: 4, max: 120, step: 1, perMinute: false },
  defense: { label: 'Турелей в линии', unit: 'шт.', noun: 'турелей', min: 2, max: 24, step: 1, perMinute: false, count: true },
};

/** Directions that have no meaningful throughput target (a processor or a launch pad is not a rate). */
export const rateDirections = Object.keys(rateMeta);

export const rateMetaFor = direction => rateMeta[direction] ?? null;

/** The target the player typed, in the direction's own unit; null when the layout is area-driven. */
export function rateTarget(settings, direction) {
  if (settings?.rateMode !== 'manual') return null;
  const value = Number(settings.rateTarget);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * How many blocks make `target` when one makes `per` (per second).
 * `target` is given in the player's unit: per minute for directions marked `perMinute`.
 * Returns `count: null` when there is no target at all — the caller keeps its own area-based sizing.
 */
export function planCount({ target, per, min = 1, max = Infinity, perMinute = false }) {
  if (!(per > 0)) return { count: min, per, total: 0, wanted: min, target: null, clamped: false, fits: false, dead: true };
  if (target == null) return { count: null, per, total: null, wanted: null, target: null, clamped: false, fits: true };
  const wantedPerSecond = perMinute ? target / 60 : target;
  const wanted = Math.max(1, Math.ceil(wantedPerSecond / per - 1e-9));
  const count = Math.max(min, Math.min(max, wanted));
  return {
    count,
    per,
    total: count * per,
    wanted,
    target,
    clamped: wanted > max || wanted < min,
    fits: wanted <= max,
  };
}

/** `total` back in the player's unit (per minute for `perMinute` directions). */
export function displayRate(total, { perMinute = false } = {}) {
  return total == null ? null : (perMinute ? total * 60 : total);
}

const round = (value, digits = 2) => Number(value.toFixed(digits));

/**
 * Tell the player what a target turned into, measured on the blocks that were actually placed — not on the
 * number that was planned: a builder is allowed to place fewer (no room, no unloader cell, no route), and
 * the player has to see the real figure. A shortfall is a requirement, not a note.
 */
export function reportRate(frame, { direction, target, per, count, noun = '', blocks = 'блоков' }) {
  if (target == null || !(per > 0) || !Number.isFinite(count)) return;
  const meta = rateMetaFor(direction) ?? {};
  const unit = meta.unit ?? 'ед./с';
  const reached = displayRate(count * per, meta);
  const wantedPerSecond = meta.perMinute ? target / 60 : target;
  const short = count * per + 1e-9 < wantedPerSecond;
  if (short) {
    frame.require(`Цель ${round(target)} ${unit} не достигнута: в схему встало ${count} ${blocks} — это ≈${round(reached)} ${unit}. Увеличь размер схемы или снизь цель.`);
    return;
  }
  frame.note(`Цель ${round(target)} ${unit}: ${count} ${blocks} дают ≈${round(reached)} ${unit}${noun ? ` «${noun}»` : ''}.`);
}

/** One crafter's output of its main product, items/second, from the recipe table. */
export function machineOutputPerSecond(machineId, recipe, goal = null) {
  const outputs = recipe?.output ?? {};
  const amount = goal && outputs[goal] != null ? outputs[goal] : (Object.values(outputs)[0] ?? 1);
  return recipe?.craftTime ? amount * 60 / recipe.craftTime : 0;
}

/** One crafter's demand for `item`, items/second. */
export function machineInputPerSecond(recipe, item) {
  const amount = recipe?.inputs?.[item] ?? 0;
  return recipe?.craftTime ? amount * 60 / recipe.craftTime : 0;
}

/** One generator's net output in power units/second, the same way the flow checker measures it. */
export function generatorOutputPerSecond(id) {
  const info = describeBlock(id);
  return info.powerMake || generatorInfo(id)?.power || 0;
}

/** One unit factory's output of a plan: units/second. */
export function factoryUnitsPerSecond(factoryId, plan) {
  const time = plan?.time ?? 0;
  return time > 0 ? 60 / time : 0;
}

/** How many parallel lanes the fastest available belt needs to carry `rate` items/second. */
export function lanesForBelt(frame, rate) {
  const belts = frame.profile.belts.filter(entry => frame.has(entry.id));
  const capacity = (belts.at(-1) ?? frame.profile.belts[0]).rate;
  return { lanes: Math.max(1, Math.ceil(rate / capacity)), capacity, belt: frame.belt(rate) };
}
