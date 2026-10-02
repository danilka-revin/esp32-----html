import { footprint, minimalProduction, trimLayout } from './mechanics.js';
import { blockById, productsByDirection } from './catalog.js';
import { getTransportItem } from './logic.js';

export const canvasPresets = {
  compact: { label: 'Компактная', width: 18, height: 16, note: '18 × 16' },
  standard: { label: 'Стандарт', width: 24, height: 18, note: '24 × 18' },
  wide: { label: 'Широкая', width: 30, height: 22, note: '30 × 22' },
};

export const supplyModes = [
  { id: 'core', label: 'От ядра', mark: '◆', hint: 'Разгрузчик забирает выбранный предмет из ядра и подаёт его по конвейерам; доступен контроль MLOG.' },
  { id: 'local', label: 'Локально', mark: '⛏', hint: 'Локальная подача: буровые для фабрики, а для юнитов — отдельный склад ресурсов.' },
  { id: 'drones', label: 'Дроны', mark: '⬡', hint: 'Перевозка выбранного предмета юнитом через процессор; код MLOG можно скопировать.' },
  { id: 'hybrid', label: 'Гибрид', mark: '↔', hint: 'Конвейерная подача от ядра плюс процессорная доставка дроном.' },
];

export const initialSettings = {
  minimal: true,
  direction: 'production',
  stage: 'mid',
  planet: 'serpulo',
  goal: 'silicon',
  footprint: 'standard',
  compactness: 68,
  includePower: true,
  includeDefense: true,
  includeStorage: true,
  supplyMode: 'core',
  processorControl: true,
  droneUnit: 'mono',
  transportItem: 'copper',
  reserveThreshold: 40,
  droneCapacity: 50,
};

const coreFor = (planet, stage) => {
  if (planet === 'erekir') {
    if (stage === 'late') return 'core-acropolis';
    if (stage === 'mid') return 'core-citadel';
    return 'core-bastion';
  }
  if (stage === 'late') return 'core-nucleus';
  if (stage === 'mid') return 'core-foundation';
  return 'core-shard';
};

const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const tileKey = (x, y) => `${x}:${y}`;
const rectFor = footprint;

export function blockRect(tile) {
  return rectFor(tile);
}

export function tileAtCell(tiles, x, y) {
  return tiles.find((tile) => {
    const rect = rectFor(tile);
    return x >= rect.startX && x <= rect.endX && y >= rect.startY && y <= rect.endY;
  }) ?? null;
}

export function blockFits(tiles, id, x, y, width, height, ignoredTile = null) {
  const size = blockById.get(id)?.size ?? 1;
  const left = x - Math.floor((size - 1) / 2);
  const top = y - Math.floor((size - 1) / 2);
  const right = left + size - 1;
  const bottom = top + size - 1;
  if (left < 0 || top < 0 || right >= width || bottom >= height) return false;
  return !tiles.some((tile) => {
    if (ignoredTile && tile === ignoredTile) return false;
    const rect = rectFor(tile);
    return left <= rect.endX && right >= rect.startX && top <= rect.endY && bottom >= rect.startY;
  });
}

function goalFor(settings) {
  const options = productsByDirection[settings.direction] ?? [];
  return options.find((option) => option.id === settings.goal) ?? options[0] ?? null;
}

function selectBlock(...ids) {
  return ids.find((id) => id && blockById.has(id)) ?? null;
}

function chooseDrill(settings, goal) {
  const late = settings.stage === 'late';
  const mid = settings.stage === 'mid';
  if (settings.planet === 'erekir') {
    if (goal?.id === 'tungsten') return selectBlock('eruption-drill', 'impact-drill', 'large-plasma-bore');
    if (goal?.id === 'thorium') return selectBlock('impact-drill', 'large-plasma-bore', 'plasma-bore');
    return selectBlock(late ? 'impact-drill' : mid ? 'large-plasma-bore' : 'plasma-bore', 'plasma-bore');
  }
  if (goal?.id === 'titanium') return selectBlock('pneumatic-drill', 'mechanical-drill');
  if (goal?.id === 'thorium') return selectBlock('laser-drill');
  return selectBlock(late ? 'laser-drill' : mid ? 'pneumatic-drill' : 'mechanical-drill', 'mechanical-drill');
}

function chooseProcessor(settings, goal) {
  if (!goal) return selectBlock('silicon-smelter', 'kiln');
  const base = settings.planet === 'erekir' ? goal.erekirBlock : goal.block;
  if (settings.direction === 'production' && !base) return null;
  const stageFallbacks = {
    copper: ['mechanical-drill'], lead: ['mechanical-drill'], titanium: ['pneumatic-drill'],
    thorium: ['laser-drill', 'impact-drill'], beryllium: ['plasma-bore'], tungsten: ['eruption-drill', 'impact-drill'],
    silicon: ['silicon-smelter', 'silicon-arc-furnace'], graphite: ['graphite-press', 'multi-press'],
    metaglass: ['kiln'], plastanium: ['plastanium-compressor', 'carbide-crucible'],
    'surge-alloy': ['surge-smelter', 'surge-crucible'], 'phase-fabric': ['phase-weaver', 'phase-synthesizer'],
    frontline: ['duo', 'breach'], 'anti-air': ['scatter', 'diffuse'], heavy: ['salvo', 'sublimate'],
    solar: ['solar-panel', 'vent-condenser'], thermal: ['thermal-generator', 'turbine-condenser'],
    reactor: ['thorium-reactor', 'flux-reactor'], conveyor: ['conveyor', 'duct'], sort: ['sorter', 'duct-router'],
    driver: ['mass-driver', 'payload-mass-driver'], ground: ['ground-factory', 'tank-fabricator'],
    air: ['air-factory', 'ship-fabricator'], naval: ['naval-factory', 'mech-fabricator'],
    processor: ['micro-processor', 'logic-processor'], display: ['logic-display', 'large-logic-display'],
    switch: ['switch', 'message'], launch: ['launch-pad'], accelerator: ['interplanetary-accelerator', 'launch-pad'],
  };
  return selectBlock(base, ...(stageFallbacks[goal.id] ?? []), 'silicon-smelter');
}

export function generateLayout(input = {}) {
  const settings = { ...initialSettings, ...input };
  if (settings.minimal && settings.direction === 'production') {
    const module = minimalProduction(settings);
    if (module) return module;
  }
  if (!supplyModes.some((mode) => mode.id === settings.supplyMode)) settings.supplyMode = 'core';
  settings.transportItem = getTransportItem(settings);
  if (settings.planet === 'erekir') {
    settings.processorControl = false;
    settings.droneUnit = 'manifold';
  }
  const coreFed = ['core', 'hybrid'].includes(settings.supplyMode);
  const localFed = settings.supplyMode === 'local';
  const droneFed = ['drones', 'hybrid'].includes(settings.supplyMode);
  const logicAvailable = settings.planet !== 'erekir';
  const needsProcessor = logicAvailable && (Boolean(settings.processorControl) || droneFed);
  const transportItemConfig = { type: 'content', contentType: 'item', id: getTransportItem(settings) };
  const preset = canvasPresets[settings.footprint] ?? canvasPresets.standard;
  const width = preset.width;
  const height = preset.height;
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const coreX = width - 4;
  const coreY = cy;
  const coreId = selectBlock(coreFor(settings.planet, settings.stage), 'core-shard');
  const coreSize = blockById.get(coreId)?.size ?? 1;
  const coreBusEnd = coreX - Math.floor(coreSize / 2) - 1;
  const target = goalFor(settings);
  const tilesByCell = new Map();
  const variation = Math.abs(Number(settings.variant) || 0) % 3;
  const variationOffset = variation - 1;
  const density = Number(settings.compactness ?? 68);
  const rowSpread = density >= 75 ? 4 : density <= 40 ? 6 : 5;

  const overlaps = (a, b) => {
    const left = rectFor(a); const right = rectFor(b);
    return left.startX <= right.endX && left.endX >= right.startX && left.startY <= right.endY && left.endY >= right.startY;
  };
  const current = () => [...tilesByCell.values()];
  const eraseOverlaps = (candidate) => {
    for (const [key, tile] of tilesByCell.entries()) {
      if (overlaps(tile, candidate)) tilesByCell.delete(key);
    }
  };
  const add = (id, x, y, rotation = 0, config = null, force = false) => {
    if (!id || !blockById.has(id)) return false;
    x = Math.round(x); y = Math.round(y);
    const tile = { id, x, y, rotation: ((rotation % 4) + 4) % 4, config };
    if (!blockFits(current(), id, x, y, width, height)) {
      if (!force) return false;
      const { startX, startY, endX, endY } = rectFor(tile);
      if (startX < 0 || startY < 0 || endX >= width || endY >= height) return false;
      if (current().some(existing => existing.id.startsWith('core-') && overlaps(existing, tile))) return false;
      eraseOverlaps(tile);
    }
    tilesByCell.set(tileKey(x, y), tile);
    return true;
  };
  const addNearestFree = (id, preferredX, preferredY, rotation = 0, config = null) => {
    const maxRadius = width + height;
    for (let radius = 0; radius <= maxRadius; radius += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (Math.abs(x - preferredX) + Math.abs(y - preferredY) !== radius) continue;
          if (add(id, x, y, rotation, config)) return { x, y };
        }
      }
    }
    return null;
  };
  const line = (id, x1, y1, x2, y2, rotation = 0, force = false) => {
    const length = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let step = 0; step <= length; step += 1) {
      const t = length === 0 ? 0 : step / length;
      add(id, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, rotation, null, force);
    }
  };
  const route = (id, fromX, fromY, toX, toY, firstRotation = 0) => {
    line(id, fromX, fromY, toX, fromY, firstRotation);
    line(id, toX, fromY, toX, toY, toX === fromX ? firstRotation : 1);
  };
  const addCoreAndStorage = () => {
    add(coreId, coreX, coreY, 0, null, true);
    if (!settings.includeStorage) return;
    const storeId = settings.planet === 'erekir' ? 'reinforced-vault' : 'vault';
    const alternate = settings.planet === 'erekir' ? 'reinforced-container' : 'container';
    const id = selectBlock(settings.stage === 'late' ? storeId : alternate, 'container', 'vault');
    add(id, coreX, cy - 5, 0, null, false);
  };
  const addPowerBackbone = (preferred = null) => {
    const generator = preferred ?? (settings.planet === 'erekir'
      ? (settings.stage === 'late' ? 'flux-reactor' : 'vent-condenser')
      : (settings.stage === 'late' ? 'impact-reactor' : settings.stage === 'mid' ? 'thermal-generator' : 'combustion-generator'));
    const solar = settings.planet === 'erekir' ? 'vent-condenser' : settings.stage === 'late' ? 'large-solar-panel' : 'solar-panel';
    const node = selectBlock(settings.planet === 'erekir' ? 'beam-node' : 'power-node', 'power-node');
    const powerX = Math.max(5, Math.round(width * 0.38));
    add(generator, powerX, cy + 5, 0);
    add(solar, Math.max(4, powerX - 4), cy - 5, 0);
    add('battery', powerX + 4, cy + 5, 0);
    add(node, powerX + 2, cy, 0);
    add(node, coreX - 2, cy, 1);
    if (settings.includePower) {
      line(node, powerX + 2, cy, coreX - 2, cy, 0);
    }
  };
  const addLogicController = (x = Math.max(2, coreX - 5), y = Math.max(2, cy + 4)) => {
    if (!logicAvailable) return null;
    const processor = selectBlock('micro-processor', 'logic-processor');
    const placed = addNearestFree(processor, x, y);
    if (placed && droneFed) addNearestFree(selectBlock('memory-cell', 'switch'), placed.x + 2, placed.y);
    return placed;
  };
  const addDroneDock = (x, y) => {
    if (!logicAvailable) {
      const loader = addNearestFree('unit-cargo-loader', x, y);
      const unloadPoint = addNearestFree('unit-cargo-unload-point', x + 4, y + 2, 0, transportItemConfig);
      return { loader, unloadPoint };
    }
    return null;
  };
  const addCoreUnloader = () => {
    if (settings.planet === 'erekir') {
      const bufferId = selectBlock('reinforced-container', 'reinforced-vault');
      const buffer = addNearestFree(bufferId, Math.max(2, coreBusEnd - 2), Math.max(2, cy - 4));
      if (!buffer) return { x: coreBusEnd - 1, y: cy };
      const bounds = rectFor({ id: bufferId, ...buffer });
      const edges = [
        [buffer.x, bounds.endY + 1, 1, 0, 1],
        [buffer.x, bounds.startY - 1, 3, 0, -1],
        [bounds.startX - 1, buffer.y, 2, -1, 0],
        [bounds.endX + 1, buffer.y, 0, 1, 0],
      ];
      for (const [x, y, rotation, dx, dy] of edges) {
        if (add('duct-unloader', x, y, rotation, transportItemConfig)) return { x: x + dx, y: y + dy };
      }
      return { x: coreBusEnd - 1, y: cy };
    }
    add('unloader', coreBusEnd, coreY, 0, transportItemConfig);
    return { x: coreBusEnd - 1, y: cy };
  };

  addCoreAndStorage();

  if (settings.direction === 'mining') {
    const drill = chooseDrill(settings, target);
    const drillSize = blockById.get(drill)?.size ?? 1;
    const drillRight = 3 + Math.floor(drillSize / 2);
    const ys = [Math.max(2, cy - rowSpread), cy, Math.min(height - 3, cy + rowSpread)];
    const mergeX = Math.min(coreBusEnd - 1, Math.max(8, Math.round(width * 0.43) + variationOffset));
    ys.forEach((y, index) => {
      add(drill, 3, y, index % 2 ? 1 : 0);
      line(selectBlock('conveyor', 'duct'), drillRight + 1, y, mergeX - 1, y, 1);
      if (index !== 1) route(selectBlock('conveyor', 'duct'), mergeX, y, mergeX, cy, 0);
    });
    add(selectBlock('router', 'duct-router'), mergeX, cy, 0, null, true);
    line(selectBlock('conveyor', 'duct'), mergeX + 1, cy, coreBusEnd, cy, 1);
    add('power-node', 6, cy - 2, 0);
    add('power-node', 6, cy + 2, 0);
    if (settings.includePower) addPowerBackbone();
  }

  if (settings.direction === 'production') {
    const machine = chooseProcessor(settings, target);
    const inputDrill = chooseDrill(settings, target);
    const machineSize = blockById.get(machine)?.size ?? 1;
    const drillSize = blockById.get(inputDrill)?.size ?? 1;
    const machineX = Math.max(7, Math.round(width * 0.40) + variationOffset);
    const machineYs = [Math.max(3, cy - rowSpread), Math.min(height - 4, cy + rowSpread)];
    const machineInputX = machineX - Math.floor(machineSize / 2) - 1;
    const machineOutputX = machineX + Math.floor(machineSize / 2) + 1;
    const belt = selectBlock(settings.planet === 'erekir' ? 'duct' : 'conveyor', 'conveyor');
    const outputX = Math.min(coreBusEnd - 1, machineX + Math.ceil(machineSize / 2) + 4);
    const outputY = Math.max(1, cy - 1);
    const feedY = Math.min(height - 2, cy + 3);

    if (localFed) {
      machineYs.forEach((y) => {
        add(inputDrill, 3, y, 0);
        const drillOutputX = 3 + Math.floor(drillSize / 2) + 1;
        line(belt, drillOutputX, y, machineInputX, y, 1);
      });
    }
    if (coreFed) {
      const source = addCoreUnloader();
      line(belt, source.x, source.y, source.x, feedY, 2);
      line(belt, machineInputX, feedY, source.x, feedY, 3);
      machineYs.forEach((y) => line(belt, machineInputX, feedY, machineInputX, y, y < feedY ? 0 : 2));
    }

    machineYs.forEach((y, index) => {
      add(machine, machineX, y, index === 0 ? 0 : 2);
      route(belt, machineOutputX, y, outputX, cy + (index === 0 ? -2 : 2), 1);
      route(belt, outputX, cy + (index === 0 ? -2 : 2), outputX, outputY, 0);
    });
    add(selectBlock('router', 'duct-router'), outputX, outputY, 0, null, true);
    line(belt, outputX + 1, outputY, coreBusEnd, outputY, 1);
    add('power-node', machineX, cy, 0);
    add('power-node', outputX - 2, cy + 3, 0);
    if (droneFed) addDroneDock(Math.max(2, coreX - 8), Math.max(2, cy - 5));
    if (needsProcessor) addLogicController(Math.max(2, machineX - 4), Math.min(height - 2, cy + 4));
    if (settings.includePower) addPowerBackbone();
    if (settings.includeDefense) {
      add(selectBlock(settings.planet === 'erekir' ? 'breach' : 'duo'), coreX - 1, cy - 6, 2);
      add(selectBlock(settings.planet === 'erekir' ? 'breach' : 'duo'), coreX - 1, cy + 6, 0);
    }
  }

  if (settings.direction === 'defense') {
    const wall = settings.planet === 'erekir'
      ? (settings.stage === 'late' ? 'carbide-wall' : settings.stage === 'mid' ? 'tungsten-wall' : 'beryllium-wall')
      : (settings.stage === 'late' ? 'thorium-wall' : settings.stage === 'mid' ? 'titanium-wall' : 'copper-wall');
    const turret = chooseProcessor(settings, target);
    const left = Math.max(2, cx - 6); const right = Math.min(width - 3, cx + 6);
    const top = Math.max(2, cy - 5); const bottom = Math.min(height - 3, cy + 5);
    const turretYTop = Math.max(2, top - 2); const turretYBottom = Math.min(height - 3, bottom + 2);
    if (coreFed) {
      const belt = selectBlock(settings.planet === 'erekir' ? 'duct' : 'conveyor', 'conveyor');
      const feedX = cx + 3;
      const feedY = Math.min(height - 3, cy + 2);
      const source = addCoreUnloader();
      line(belt, source.x, source.y, source.x, feedY, 2);
      line(belt, feedX, feedY, coreBusEnd, feedY, 3);
      line(belt, feedX, turretYTop, feedX, turretYBottom, 0);
      line(belt, cx - 3, turretYTop, feedX, turretYTop, 1);
      line(belt, cx - 3, turretYBottom, feedX, turretYBottom, 1);
    }
    if (localFed) addNearestFree(selectBlock(settings.planet === 'erekir' ? 'reinforced-container' : 'container', 'vault'), left + 2, cy);
    line(wall, left, top, right, top, 0);
    line(wall, left, bottom, right, bottom, 0);
    line(wall, left, top + 1, left, bottom - 1, 1);
    line(wall, right, top + 1, right, bottom - 1, 1);
    const profileTurret = target?.id === 'anti-air'
      ? (settings.planet === 'erekir' ? 'diffuse' : 'scatter')
      : target?.id === 'heavy'
        ? (settings.planet === 'erekir' ? 'sublimate' : 'salvo')
        : (settings.planet === 'erekir' ? 'breach' : 'duo');
    const supportTurret = settings.planet === 'erekir' ? 'breach' : 'duo';
    const turrets = settings.stage === 'late'
      ? [profileTurret, settings.planet === 'erekir' ? 'smite' : 'salvo']
      : [profileTurret, supportTurret];
    [[cx - 4, turretYTop, 0], [cx + 4, turretYTop, 0], [cx - 4, turretYBottom, 2], [cx + 4, turretYBottom, 2]].forEach(([x, y, rot], i) => add(selectBlock(turrets[i % turrets.length], turret), x, y, rot, null, true));
    addNearestFree(selectBlock(settings.planet === 'erekir' ? 'regen-projector' : 'mend-projector', 'mender'), cx - 5, cy);
    addNearestFree(selectBlock(settings.planet === 'erekir' ? 'barrier-projector' : 'force-projector', 'mender'), cx + 5, cy);
    if (droneFed) addDroneDock(Math.max(2, left - 1), Math.max(2, top - 1));
    if (needsProcessor) addLogicController(Math.max(2, left + 1), Math.min(height - 2, bottom + 2));
    if (settings.includePower) addPowerBackbone();
  }

  if (settings.direction === 'power') {
    const solar = settings.planet === 'erekir' ? 'vent-condenser' : settings.stage === 'late' ? 'large-solar-panel' : 'solar-panel';
    const generator = settings.planet === 'erekir'
      ? (settings.stage === 'late' ? 'flux-reactor' : 'turbine-condenser')
      : (settings.stage === 'late' ? 'impact-reactor' : settings.stage === 'mid' ? 'thermal-generator' : 'combustion-generator');
    const node = selectBlock(settings.planet === 'erekir' ? 'beam-node' : 'power-node', 'power-node');
    const solarY = Math.max(2, cy - 5);
    const generatorY = Math.min(height - 3, cy + 5);
    [4, 9, 14].forEach((x, index) => add(solar, x, solarY, 0));
    [6, 12].forEach((x, index) => add(generator, x, generatorY, index ? 1 : 0));
    [5, 9, 13].forEach((x) => add('battery', x, cy, 0));
    [6, 12, coreX - 2].forEach((x) => add(node, x, cy - 2, 0));
    line(node, 6, cy - 2, coreX - 2, cy - 2, 1);
    if (settings.includeDefense) {
      add(selectBlock(settings.planet === 'erekir' ? 'breach' : 'duo'), 4, cy + 1, 1);
      add(selectBlock(settings.planet === 'erekir' ? 'breach' : 'duo'), 14, cy + 1, 3);
    }
  }

  if (settings.direction === 'logistics') {
    const belt = selectBlock(settings.planet === 'erekir' ? 'duct' : 'conveyor', 'conveyor');
    const router = selectBlock(settings.planet === 'erekir' ? 'duct-router' : 'router', 'router');
    const junction = selectBlock(settings.planet === 'erekir' ? 'duct-bridge' : 'junction', 'router');
    if (coreFed) {
      const source = addCoreUnloader();
      line(belt, source.x, source.y, source.x, cy, 2);
      line(belt, 3, cy, source.x, cy, 1);
    } else {
      line(belt, 3, cy, coreX - 2, cy, 1);
    }
    const branchX = Math.round(width * 0.42) + variationOffset;
    const branchSpread = density >= 75 ? 3 : 4;
    line(belt, branchX, cy - branchSpread, branchX, cy + branchSpread, 0);
    add(router, branchX, cy, 0, null, true);
    add(selectBlock(settings.planet === 'erekir' ? 'duct-bridge' : 'item-bridge', junction), branchX, cy - branchSpread, 0);
    add(selectBlock(settings.planet === 'erekir' ? 'overflow-duct' : 'overflow-gate', 'router'), branchX, cy + branchSpread, 2);
    add(selectBlock('sorter', settings.planet === 'erekir' ? 'duct-router' : 'router'), branchX + 4, cy - 3, 0, { item: 'copper' });
    add(selectBlock('inverted-sorter', 'sorter'), branchX + 4, cy + 3, 2, { item: 'lead' });
    if (settings.stage === 'late') {
      add(selectBlock('mass-driver', 'payload-mass-driver'), 4, cy - 5, 1);
      add(selectBlock('mass-driver', 'payload-mass-driver'), coreX - 4, cy - 5, 3);
    }
    if (droneFed) addDroneDock(Math.max(2, coreX - 8), Math.max(2, cy - 5));
    if (needsProcessor) addLogicController(Math.max(2, branchX - 3), Math.min(height - 2, cy + 4));
    if (settings.includePower) addPowerBackbone();
  }

  if (settings.direction === 'units') {
    const factory = chooseProcessor(settings, target);
    const reconstructor = settings.planet === 'erekir'
      ? (settings.stage === 'late' ? 'prime-refabricator' : 'tank-refabricator')
      : (settings.stage === 'late' ? 'tetrative-reconstructor' : settings.stage === 'mid' ? 'additive-reconstructor' : 'ground-factory');
    const payloadBelt = selectBlock(settings.planet === 'erekir' ? 'payload-conveyor' : 'conveyor', 'conveyor');
    const itemBelt = selectBlock(settings.planet === 'erekir' ? 'duct' : 'conveyor', 'conveyor');
    const factoryRows = [cy - 5, cy + 5];
    const alternateFactory = settings.planet === 'erekir'
      ? (target?.id === 'air' ? 'tank-fabricator' : 'ship-fabricator')
      : (target?.id === 'air' ? 'ground-factory' : 'air-factory');
    const factoryIds = [factory, selectBlock(alternateFactory, factory)];
    factoryRows.forEach((y, index) => add(factoryIds[index], 4, y, index ? 2 : 0));
    const reconstructorX = Math.round(width * 0.52);
    add(reconstructor, reconstructorX, cy, 0);
    const leftOfReconstructor = reconstructorX - Math.floor((blockById.get(reconstructor)?.size ?? 1) / 2) - 1;
    line(payloadBelt, 7, cy, leftOfReconstructor, cy, 1);
    add(selectBlock(settings.planet === 'erekir' ? 'unit-repair-tower' : 'repair-point', 'mender'), 7, cy + 4, 0);

    if (coreFed) {
      const feedY = Math.min(height - 2, cy + 3);
      const source = addCoreUnloader();
      line(itemBelt, source.x, source.y, source.x, feedY, 2);
      line(itemBelt, 6, feedY, source.x, feedY, 3);
      line(itemBelt, 6, feedY, 6, factoryRows[0], 0);
      line(itemBelt, 6, feedY, 6, factoryRows[1], 2);
    }
    if (localFed) addNearestFree(selectBlock(settings.planet === 'erekir' ? 'reinforced-container' : 'container', 'vault'), 7, Math.min(height - 2, cy + 5));
    if (droneFed) addDroneDock(Math.max(2, coreX - 8), Math.max(2, cy - 5));
    if (needsProcessor) addLogicController(Math.max(2, coreX - 5), Math.min(height - 2, cy + 4));
    if (settings.includePower) addPowerBackbone();
    if (settings.includeDefense) add(selectBlock(settings.planet === 'erekir' ? 'breach' : 'duo'), coreX - 1, cy - 5, 2);
  }

  if (settings.direction === 'logic') {
    if (!logicAvailable) {
      addNearestFree('unit-cargo-loader', 5, cy - 3);
      addNearestFree('unit-cargo-unload-point', 13, cy - 1, 0, transportItemConfig);
      addNearestFree('reinforced-container', 5, cy + 5);
    } else {
      const cpu = selectBlock(settings.stage === 'late' ? 'hyper-processor' : 'micro-processor', 'micro-processor');
      const memory = selectBlock(settings.stage === 'late' ? 'memory-bank' : 'memory-cell', 'memory-cell');
      const display = selectBlock('large-logic-display', 'logic-display');
      const switchId = selectBlock('switch', 'message');
      const row = Math.max(3, cy - 4);
      add(cpu, 4, row, 0);
      add(memory, 8, row, 0);
      add(switchId, 12, row, 0);
      add(display, 6, cy + 4, 0);
      add(selectBlock('logic-display', 'message'), 14, cy + 4, 0);
      add('power-node', 10, cy, 0);
      add('power-node', 16, cy, 1);
    }
    if (settings.includePower) addPowerBackbone();
  }

  if (settings.direction === 'campaign') {
    const launch = settings.stage === 'late' ? 'interplanetary-accelerator' : 'launch-pad';
    const belt = selectBlock(settings.planet === 'erekir' ? 'payload-conveyor' : 'conveyor', 'conveyor');
    const launchX = width <= 18 ? Math.round(width * 0.40) : Math.round(width * 0.43);
    add(launch, launchX, cy, 0, null, false);
    const launchSize = blockById.get(launch)?.size ?? 1;
    const start = launchX - Math.floor(launchSize / 2) - 1;
    line(belt, 3, cy, start, cy, 1);
    add(selectBlock(settings.planet === 'erekir' ? 'beam-node' : 'power-node', 'power-node'), launchX, cy - 5, 0);
    add(selectBlock('launch-pad', 'interplanetary-accelerator'), Math.max(4, launchX - 1), cy + 5, 0);
    if (settings.includePower) addPowerBackbone();
  }

  // Keep a visible, useful storage marker in non-storage layouts when there is room.
  if (settings.includeStorage && settings.direction !== 'mining' && settings.direction !== 'production' && settings.direction !== 'logistics') {
    const storage = selectBlock(settings.planet === 'erekir' ? 'reinforced-container' : 'container', 'vault');
    add(storage, coreX, cy + 5, 0);
  }

  const tiles = current().sort((a, b) => a.y - b.y || a.x - b.x);
  const product = target?.label ?? 'Схема';
  const stageLabel = settings.stage === 'late' ? 'эндгейм' : settings.stage === 'mid' ? 'развитие' : 'старт';
  const planetLabel = settings.planet === 'erekir' ? 'Эрекир' : 'Серпуло';
  const directionName = {
    mining: 'добыча', production: 'производство', defense: 'оборона', power: 'энергетика',
    logistics: 'логистика', units: 'юниты', logic: 'логика', campaign: 'кампания',
  }[settings.direction] ?? 'Mindustry';
  const supplyLabel = supplyModes.find((mode) => mode.id === settings.supplyMode)?.label ?? 'От ядра';
  const supplyDescription = ['production', 'defense', 'units', 'logistics'].includes(settings.direction) ? ` · снабжение: ${supplyLabel.toLowerCase()}` : '';

  const result = {
    width,
    height,
    tiles,
    name: `${product} · ${planetLabel}`,
    description: `${directionName} · ${stageLabel}${supplyDescription} · ванильные блоки Mindustry v146`,
    tags: {
      name: `${product} · ${planetLabel}`,
      description: `${directionName} · ${stageLabel}${supplyDescription}`,
      planet: settings.planet,
      direction: settings.direction,
      goal: target?.id ?? settings.goal,
      minimal: String(Boolean(settings.minimal)),
      supplyMode: settings.supplyMode,
      processorControl: String(Boolean(settings.processorControl)),
      droneUnit: settings.droneUnit,
      transportItem: settings.transportItem,
      reserveThreshold: String(settings.reserveThreshold),
      droneCapacity: String(settings.droneCapacity),
    },
    settings: { ...settings, goal: target?.id ?? settings.goal, variant: variation },
  };
  return settings.minimal ? trimLayout(result) : result;
}
