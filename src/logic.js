import { itemById } from './catalog.js';

const defaultItemForPlanet = (planet) => (planet === 'erekir' ? 'beryllium' : 'copper');

export function getTransportItem(settings = {}) {
  const preferred = settings.transportItem || defaultItemForPlanet(settings.planet);
  const item = itemById.get(preferred);
  if (item && (item.planet === 'both' || item.planet === settings.planet)) return preferred;
  return defaultItemForPlanet(settings.planet);
}

export function needsLogicProgram(settings = {}) {
  if (settings.planet === 'erekir') return false;
  const relevantDirection = ['production', 'defense', 'units', 'logistics'].includes(settings.direction);
  return relevantDirection && (settings.processorControl || ['drones', 'hybrid'].includes(settings.supplyMode));
}

export function getLogicLinkInstructions(settings = {}) {
  const item = getTransportItem(settings);
  const target = settings.direction === 'defense' ? 'турель' : settings.direction === 'logistics' ? 'блок назначения' : 'фабрику';
  if (['drones', 'hybrid'].includes(settings.supplyMode)) {
    const ordinal = settings.direction === 'logistics' ? 'первым' : 'первой';
    const hybridNote = settings.supplyMode === 'hybrid' ? ` Для конвейерной линии настрой разгрузчик на @${item}.` : '';
    return `Свяжи ${target} ${ordinal} (слот 0); ядро скрипт найдёт автоматически.${hybridNote}`;
  }
  const targetNoun = settings.direction === 'defense' ? 'турель' : settings.direction === 'logistics' ? 'блок назначения' : 'фабрику';
  const unloaderNote = settings.supplyMode === 'core' ? ` Настрой разгрузчик на @${item}.` : '';
  return `Свяжи ядро первым (слот 0), затем ${targetNoun} (слот 1).${unloaderNote}`;
}

function buildReserveProgram(settings) {
  const target = settings.direction === 'defense' ? 'turret' : settings.direction === 'logistics' ? 'route' : 'factory';
  const item = getTransportItem(settings);
  const reserve = Math.max(10, Math.min(1000, Number(settings.reserveThreshold) || 40));
  return [
    'getlink core 0',
    `getlink ${target} 1`,
    `sensor stock core @${item}`,
    `jump 6 lessThan stock ${reserve}`,
    `control enabled ${target} 1 0 0 0 0`,
    'jump 7 always 0 0',
    `control enabled ${target} 0 0 0 0 0`,
    'end',
  ].join('\n');
}

function buildDroneProgram(settings) {
  const unit = settings.planet === 'erekir' ? 'manifold' : (settings.droneUnit || 'mono');
  const item = getTransportItem(settings);
  const capacity = Math.max(10, Math.min(999, Number(settings.droneCapacity) || 50));
  return [
    'getlink factory 0',
    `ulocate building core false @${item} cx cy found core`,
    'sensor tx factory @x',
    'sensor ty factory @y',
    `ubind @${unit}`,
    'jump 13 equal @unit null',
    'sensor cargo @unit @totalItems',
    'jump 11 greaterThan cargo 0',
    'ucontrol approach cx cy 5 0 0',
    `ucontrol itemTake core @${item} ${capacity} 0 0`,
    'end',
    'ucontrol approach tx ty 5 0 0',
    `ucontrol itemDrop factory ${capacity} 0 0 0`,
    'end',
  ].join('\n');
}

export function buildLogicProgram(settings = {}) {
  if (!needsLogicProgram(settings)) return '';
  if (['drones', 'hybrid'].includes(settings.supplyMode)) return buildDroneProgram(settings);
  return buildReserveProgram(settings);
}

export function getLogicProgramMode(settings = {}) {
  if (['drones', 'hybrid'].includes(settings.supplyMode)) return 'unit-logistics';
  return 'reserve-control';
}

export function isKnownTransportItem(id) {
  return itemById.has(id);
}
