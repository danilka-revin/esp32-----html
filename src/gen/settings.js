export const canvasPresets = {
  compact: { label: 'Компактная', width: 18, height: 16, note: '18 × 16' },
  standard: { label: 'Стандарт', width: 24, height: 18, note: '24 × 18' },
  wide: { label: 'Широкая', width: 30, height: 22, note: '30 × 22' },
};

export const supplyModes = [
  { id: 'core', label: 'От ядра', mark: '◆', hint: 'Разгрузчик забирает нужный предмет из ядра и подаёт его по отдельной линии на каждый ресурс; доступен контроль MLOG.' },
  { id: 'local', label: 'Локально', mark: '⛏', hint: 'Локальная подача: сырьё добывают буровые рядом, остальное берётся из отдельного склада с входом снаружи.' },
  { id: 'drones', label: 'Дроны', mark: '⬡', hint: 'Перевозка выбранного предмета юнитом через процессор с готовым кодом MLOG и связями.' },
  { id: 'hybrid', label: 'Гибрид', mark: '↔', hint: 'Конвейерная подача от ядра плюс доставка дроном для запаса.' },
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
  campaignLink: false,
};
