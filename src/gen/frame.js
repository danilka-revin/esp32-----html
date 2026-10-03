import { Board } from '../layout-kit.js';
import { itemById } from '../catalog.js';
import { describeBlock } from '../flow.js';
import { DIRS, cellKey, footprint, opposite, ringCells, blockSize } from '../geometry.js';
import { getTransportItem } from '../logic.js';
import { PROFILES, availableOn, chooseBelt, coreIdFor, pickBlock, profileFor, stageTier } from './profile.js';
import { canvasPresets, initialSettings, supplyModes } from './settings.js';

export const itemConfig = id => ({ type: 'content', contentType: 'item', id });

export function normalizeSettings(input = {}) {
  const settings = { ...initialSettings, ...input };
  if (!supplyModes.some(mode => mode.id === settings.supplyMode)) settings.supplyMode = 'core';
  settings.transportItem = getTransportItem(settings);
  if (settings.planet === 'erekir') {
    settings.processorControl = false;
    settings.droneUnit = 'manifold';
  }
  return settings;
}

/** Small deterministic PRNG so variants differ but stay reproducible. */
export function seeded(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

/** Everything a direction builder needs: board, planet profile, core and shared helpers. */
export class Frame {
  constructor(settings) {
    this.settings = settings;
    this.planet = settings.planet === 'erekir' ? 'erekir' : 'serpulo';
    this.stage = settings.stage;
    this.profile = profileFor(this.planet);
    const preset = canvasPresets[settings.footprint] ?? canvasPresets.standard;
    // `width`/`height` are the footprint budget chosen by the player; the board is larger so that a layout that
    // really needs more room (a buffer hub, a long lane) can overflow instead of failing.
    this.width = preset.width;
    this.height = preset.height;
    this.board = new Board({ width: this.width + 20, height: this.height + 16, planet: this.planet });
    this.soft = { minX: 0, maxX: this.board.width - 1, minY: 0, maxY: this.board.height - 1 };
    this.variant = Math.abs(Number(settings.variant) || 0) % 3;
    this.random = seeded(hash(`${settings.direction}|${settings.goal}|${settings.planet}|${settings.stage}|${settings.variant}`));
    this.notes = [];
    this.requirements = [];
    this.inlets = [];
    this.failures = [];
    this.core = null;
    this.coreRect = null;
  }

  /** Throw-away copy for trial placements: shares settings, owns its board and failure list. */
  fork() {
    const copy = Object.create(Frame.prototype);
    Object.assign(copy, this);
    copy.board = this.board.clone();
    copy.failures = [];
    copy.notes = [...this.notes];
    copy.requirements = [...this.requirements];
    copy.inlets = this.inlets.map(inlet => ({ ...inlet }));
    copy.core = copy.board.tileAt(this.core.x, this.core.y);
    return copy;
  }

  note(text) { if (text && !this.notes.includes(text)) this.notes.push(text); }
  require(text) { if (text && !this.requirements.includes(text)) this.requirements.push(text); }
  fail(text) { this.failures.push(text); }
  /** Declare a lane end the player connects to an outside supply (`kind`: item | liquid | power). */
  inlet({ x, y, kind, id = null }) { this.inlets.push({ x, y, kind, id }); }

  /** Pick a block id usable on this planet at this stage. */
  pick(...candidates) { return pickBlock(this.planet, this.stage, candidates.flat()); }
  /** The block exists in the campaign palette *and* can be built on this planet. */
  has(id) { return Boolean(id) && availableOn(id, this.planet); }
  belt(rate) { return chooseBelt(this.planet, this.stage, rate); }
  get tier() { return stageTier(this.stage); }
  /** Preferred room between modules; the density slider trades space for compactness. */
  get gap() { return this.settings.compactness >= 75 ? 1 : this.settings.compactness <= 40 ? 3 : 2; }

  placeCore({ marginEast = 1, offsetY = 0 } = {}) {
    const id = coreIdFor(this.planet, this.stage);
    const size = blockSize(id);
    const startX = this.board.width - size - marginEast;
    const startY = Math.floor((this.board.height - size) / 2) + offsetY;
    this.core = this.board.placeAtStart(id, startX, startY, 0, null, { role: 'core' });
    this.coreRect = footprint(this.core);
    // Soft limits: the region the footprint preset asks for, measured from the core.
    const centerY = this.coreRect.startY + Math.floor((size - 1) / 2);
    const minY = centerY - Math.floor(this.height / 2);
    this.soft = {
      minX: this.coreRect.endX + marginEast + 1 - this.width, maxX: this.coreRect.endX + marginEast,
      minY, maxY: minY + this.height - 1,
    };
    return this.core;
  }

  /** Cells that touch one face of the core; `side` is the outward direction (0 east, 1 north, 2 west, 3 south). */
  coreFace(side) { return ringCells(this.coreRect).filter(cell => cell.side === side && this.board.isFree(cell.x, cell.y)); }

  /** First lane cell beyond a supply block at `slot`, going outward. */
  laneStart(slot, side = slot.side) {
    return { x: slot.x + DIRS[side].x, y: slot.y + DIRS[side].y, dir: side };
  }

  /**
   * Route one lane from `start` to the face of a consumer. `end` is the last lane cell, `endRotation` points into the block.
   * Returns the placed tiles or null (a failure note is recorded).
   */
  connect({ start, end, endRotation, rate = 1, kind = 'item', label = '', allow = [], avoid = [], crossCost }) {
    const liquid = kind === 'liquid';
    // A lane may always use its own start, the cell in front of the start and its final cell.
    const escape = start.dir != null ? { x: start.x + DIRS[start.dir].x, y: start.y + DIRS[start.dir].y } : null;
    allow = [...allow, ...(escape ? [escape] : [])];
    const lane = liquid ? this.profile.conduits.find(entry => this.has(entry.id))?.id : this.belt(rate);
    const junction = liquid ? this.profile.liquidJunction : this.profile.junction;
    const path = this.board.route({
      start, end, endRotation, lane, junction: junction && this.has(junction) ? junction : null,
      hazard: liquid ? 'liquid' : 'item', allow, avoid, ...(crossCost != null ? { crossCost } : {}),
    });
    if (!path) { this.fail(`Не удалось провести линию${label ? ` «${label}»` : ''}: нет свободного пути.`); return null; }
    const placed = this.board.commitRoute(path, { lane, junction: junction ?? 'junction' });
    this.board.releaseReservation([start, ...(escape ? [escape] : [])]);
    return placed;
  }

  scheme({ name, description, direction, goalId, extraTags = {}, notes = [] }) {
    const settings = this.settings;
    const planetLabel = this.planet === 'erekir' ? 'Эрекир' : 'Серпуло';
    const result = {
      width: this.width,
      height: this.height,
      tiles: this.board.toTiles(),
      name: `${name} · ${planetLabel}`,
      description,
      tags: {
        name: `${name} · ${planetLabel}`,
        description: description.split(' · ванильные')[0],
        planet: settings.planet,
        direction,
        goal: goalId ?? settings.goal,
        minimal: String(Boolean(settings.minimal)),
        supplyMode: settings.supplyMode,
        processorControl: String(Boolean(settings.processorControl)),
        droneUnit: settings.droneUnit,
        transportItem: settings.transportItem,
        reserveThreshold: String(settings.reserveThreshold),
        droneCapacity: String(settings.droneCapacity),
        campaignLink: String(Boolean(settings.campaignLink)),
        ...extraTags,
      },
      settings: { ...settings, goal: goalId ?? settings.goal, variant: this.variant },
      notes: [...this.notes, ...notes],
      requirements: [...this.requirements],
      problems: [...this.failures],
      inlets: this.inlets.map(inlet => ({ ...inlet })),
    };
    return result;
  }
}

/** Lane geometry shared by feed chains: consumers hang on both sides of a straight spine of belts and routers. */
export function buildSpine(frame, {
  start, dir, length, left = [], right = [], belt, router, skipFirst = 1, item = null,
}) {
  const board = frame.board;
  const cells = [];
  for (let index = 0; index < length; index += 1) {
    const x = start.x + DIRS[dir].x * index;
    const y = start.y + DIRS[dir].y * index;
    if (!board.isFree(x, y)) break;
    cells.push({ x, y });
  }
  if (!cells.length) return { cells: [], consumers: [], routers: [] };
  const leftDir = (dir + 1) % 4;
  const rightDir = (dir + 3) % 4;
  const queueLeft = [...left];
  const queueRight = [...right];
  const placed = [];
  const routerRows = [];

  // Footprint start corner for a consumer of `size` whose first row along the spine is `row`.
  const startFor = (side, row, size) => {
    const base = cells[Math.min(row, cells.length - 1)];
    const along = DIRS[dir];
    const across = DIRS[side];
    const lowestX = [];
    const lowestY = [];
    for (let along_i = 0; along_i < size; along_i += 1) {
      for (let across_i = 1; across_i <= size; across_i += 1) {
        lowestX.push(base.x + along.x * along_i + across.x * across_i);
        lowestY.push(base.y + along.y * along_i + across.y * across_i);
      }
    }
    return { startX: Math.min(...lowestX), startY: Math.min(...lowestY) };
  };

  let row = skipFirst;
  while (queueLeft.length || queueRight.length) {
    const wantLeft = queueLeft[0];
    const wantRight = queueRight[0];
    const sizeLeft = wantLeft ? blockSize(wantLeft.id ?? wantLeft) : 0;
    const sizeRight = wantRight ? blockSize(wantRight.id ?? wantRight) : 0;
    const extent = Math.max(sizeLeft, sizeRight);
    if (row + extent > cells.length) break;
    const overlapSize = sizeLeft && sizeRight ? Math.min(sizeLeft, sizeRight) : extent;
    const routerRow = row + Math.floor((overlapSize - 1) / 2);
    let fed = 0;
    for (const [spec, side, size, queue] of [[wantLeft, leftDir, sizeLeft, queueLeft], [wantRight, rightDir, sizeRight, queueRight]]) {
      if (!spec) continue;
      queue.shift();
      const id = spec.id ?? spec;
      const corner = startFor(side, row, size);
      // A consumer taller than the router's row must still touch it: shift along the spine when needed.
      const tile = board.placeAtStart(id, corner.startX, corner.startY, spec.rotation ?? 0, spec.config ?? null, { role: spec.role ?? 'consumer', ...spec.meta });
      if (tile) { placed.push(tile); fed += 1; }
    }
    if (fed) routerRows.push(routerRow);
    row += extent + (extent === 1 ? 1 : 0);
  }
  const lastRow = routerRows.length ? routerRows[routerRows.length - 1] : -1;
  const routers = [];
  for (let index = 0; index <= lastRow; index += 1) {
    const cell = cells[index];
    if (routerRows.includes(index)) {
      const tile = board.place(router, cell.x, cell.y, describeBlock(router).rotates ? dir : 0, null, { role: 'router', ignoreReservation: true });
      if (tile) routers.push(tile);
    } else {
      board.place(belt, cell.x, cell.y, dir, null, { role: 'spine', lane: true, ignoreReservation: true });
    }
  }
  return { cells: cells.slice(0, lastRow + 1), consumers: placed, routers, queueLeft, queueRight };
}

/**
 * Run `build(frame, option)` for the first option that completes without a failure on a throw-away copy, then repeat it
 * on the real frame. Falls back to the first option so that a failure is still visible to the player.
 */
export function firstThatFits(frame, options, build) {
  for (const option of options) {
    const trial = frame.fork();
    const before = trial.failures.length;
    const result = build(trial, option);
    if (trial.failures.length === before && result !== false) return { option, result: build(frame, option) };
  }
  return { option: options[0], result: build(frame, options[0]) };
}

export function neighborsOfTile(frame, tile) { return frame.board.neighbors(tile); }
export function isItem(id) { return itemById.has(id); }
export { cellKey, opposite, PROFILES, describeBlock };
