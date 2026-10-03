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

/** How the amount of machines is chosen: from the canvas, or from a throughput the player typed. */
export const rateModes = [
  { id: 'auto', label: 'По площади', hint: 'Генератор ставит столько блоков, сколько влезает в выбранный холст.' },
  { id: 'manual', label: 'По цели', hint: 'Число блоков считается от нужного выхода. Если цель не влезает в холст, схема честно скажет, сколько удалось выжать.' },
];

/** Where the liquids a recipe needs come from. */
export const liquidSources = [
  { id: 'auto', label: 'Авто', hint: 'Вода добывается экстрактором внутри схемы, остальные жидкости приходят по трубе снаружи.' },
  { id: 'internal', label: 'В схеме', hint: 'Ставить добычу жидкости внутри схемы там, где игра это позволяет (вода, масло, азот...).' },
  { id: 'external', label: 'Снаружи', hint: 'Никакой добычи жидкости: только помеченные входы труб.' },
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
  rateMode: 'auto',
  rateTarget: 6,
  liquidSource: 'auto',
  useBridges: true,
  allowPhase: false,
  useGates: true,
};
