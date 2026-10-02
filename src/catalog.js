import rawCatalog from './catalog.json' with { type: 'json' };
import facts from './block-facts.json' with { type: 'json' };
const catalog = rawCatalog.map(entry => entry.type === 'block' ? { ...entry, size: facts[entry.id]?.size ?? entry.size } : entry);

export const gameCatalog = catalog;
export const gameBlocks = catalog.filter((entry) => entry.type === 'block');
export const buildableBlocks = gameBlocks.filter((entry) => entry.buildable);
export const materials = catalog.filter((entry) => entry.type === 'item');
export const liquids = catalog.filter((entry) => entry.type === 'liquid');
export const units = catalog.filter((entry) => entry.type === 'unit');
export const blockById = new Map(buildableBlocks.map((block) => [block.id, block]));
export const itemById = new Map(materials.map((item) => [item.id, item]));
export const objectByKey = new Map(catalog.map((entry) => [`${entry.type}:${entry.id}`, entry]));

export const categories = [
  { id: 'mining', label: 'Добыча', icon: '⛏', hint: 'Руды и буровые' },
  { id: 'production', label: 'Производство', icon: '▦', hint: 'Переработка ресурсов' },
  { id: 'logistics', label: 'Логистика', icon: '⇢', hint: 'Конвейеры и сортировка' },
  { id: 'power', label: 'Энергетика', icon: 'ϟ', hint: 'Генерация и накопление' },
  { id: 'defense', label: 'Оборона', icon: '⬡', hint: 'Стены, турели и поддержка' },
  { id: 'turret', label: 'Турели', icon: '⊙', hint: 'Защита периметра' },
  { id: 'storage', label: 'Ядро и склад', icon: '◆', hint: 'Хранение ресурсов' },
  { id: 'liquid', label: 'Жидкости', icon: '◍', hint: 'Насосы и трубы' },
  { id: 'units', label: 'Юниты', icon: '⬟', hint: 'Фабрики и реконструкторы' },
  { id: 'logic', label: 'Логика', icon: '⌘', hint: 'Процессоры и память' },
  { id: 'payload', label: 'Грузы', icon: '◇', hint: 'Погрузка и платформы' },
  { id: 'campaign', label: 'Кампания', icon: '✦', hint: 'Запуск и межпланетные блоки' },
  { id: 'sandbox', label: 'Песочница', icon: '∞', hint: 'Тестовые блоки' },
  { id: 'surface', label: 'Поверхности', icon: '▧', hint: 'Покрытия и ландшафт' },
  { id: 'ore', label: 'Руды', icon: '◈', hint: 'Рудные залежи' },
  { id: 'boulder', label: 'Обломки', icon: '⬢', hint: 'Валуны и кристаллы' },
];

export const categoryById = new Map(categories.map((category) => [category.id, category]));

export const stageMeta = {
  early: {
    label: 'Старт',
    longLabel: 'Ранняя игра',
    number: '01',
    resourceLine: 'Медь · свинец · базовая энергия',
    color: 'mint',
  },
  mid: {
    label: 'Развитие',
    longLabel: 'Середина игры',
    number: '02',
    resourceLine: 'Титан · кремний · переработка',
    color: 'blue',
  },
  late: {
    label: 'Эндгейм',
    longLabel: 'Поздняя игра',
    number: '03',
    resourceLine: 'Торий · фазовая ткань · сплавы',
    color: 'gold',
  },
};

export const directionMeta = {
  mining: { label: 'Добыча ресурсов', short: 'Добыча', icon: '⛏', goal: 'Медная руда', output: '+42 ед./мин' },
  production: { label: 'Производственная линия', short: 'Производство', icon: '▦', goal: 'Кремний', output: '+18 ед./мин' },
  defense: { label: 'Оборонительный узел', short: 'Оборона', icon: '⬡', goal: 'Удержание сектора', output: '4 сектора огня' },
  power: { label: 'Энергетический узел', short: 'Энергетика', icon: 'ϟ', goal: 'Энергия', output: '+1.8k ед./с' },
  logistics: { label: 'Транспортный хаб', short: 'Логистика', icon: '⇢', goal: 'Поток предметов', output: '3 маршрута' },
  units: { label: 'Сборочный цех', short: 'Юниты', icon: '⬟', goal: 'Наземные юниты', output: '2 линии сборки' },
  logic: { label: 'Логический модуль', short: 'Логика', icon: '⌘', goal: 'Автоматизация', output: '3 узла связи' },
  campaign: { label: 'Пусковая площадка', short: 'Кампания', icon: '✦', goal: 'Запуск груза', output: '1 межпланетный маршрут' },
};

export const productsByDirection = {
  mining: [
    { id: 'copper', label: 'Медь', block: 'mechanical-drill', erekirBlock: 'plasma-bore' },
    { id: 'lead', label: 'Свинец', block: 'mechanical-drill', erekirBlock: 'plasma-bore' },
    { id: 'titanium', label: 'Титан', block: 'pneumatic-drill', erekirBlock: 'large-plasma-bore' },
    { id: 'thorium', label: 'Торий', block: 'laser-drill', erekirBlock: 'impact-drill' },
    { id: 'beryllium', label: 'Бериллий', block: 'mechanical-drill', erekirBlock: 'plasma-bore' },
    { id: 'tungsten', label: 'Вольфрам', block: 'blast-drill', erekirBlock: 'eruption-drill' },
  ],
  production: [
    { id: 'silicon', label: 'Кремний', block: 'silicon-smelter', erekirBlock: 'silicon-arc-furnace' },
    { id: 'carbide', label: 'Карбид', block: null, erekirBlock: 'carbide-crucible' },
    { id: 'graphite', label: 'Графит', block: 'graphite-press', erekirBlock: null },
    { id: 'metaglass', label: 'Метастекло', block: 'kiln', erekirBlock: null },
    { id: 'plastanium', label: 'Пластаний', block: 'plastanium-compressor', erekirBlock: null },
    { id: 'surge-alloy', label: 'Кинетический сплав', block: 'surge-smelter', erekirBlock: 'surge-crucible' },
    { id: 'phase-fabric', label: 'Фазовая ткань', block: 'phase-weaver', erekirBlock: 'phase-synthesizer' },
  ],
  defense: [
    { id: 'frontline', label: 'Линия фронта', block: 'duo', erekirBlock: 'breach' },
    { id: 'anti-air', label: 'ПВО', block: 'scatter', erekirBlock: 'diffuse' },
    { id: 'heavy', label: 'Тяжёлая оборона', block: 'salvo', erekirBlock: 'sublimate' },
  ],
  power: [
    { id: 'solar', label: 'Солнечная сеть', block: 'solar-panel', erekirBlock: 'vent-condenser' },
    { id: 'thermal', label: 'Тепловая станция', block: 'thermal-generator', erekirBlock: 'turbine-condenser' },
    { id: 'reactor', label: 'Реакторный узел', block: 'thorium-reactor', erekirBlock: 'flux-reactor' },
  ],
  logistics: [
    { id: 'conveyor', label: 'Конвейерная магистраль', block: 'conveyor', erekirBlock: 'duct' },
    { id: 'sort', label: 'Сортировка ресурсов', block: 'sorter', erekirBlock: 'duct-router' },
    { id: 'driver', label: 'Масс-драйверы', block: 'mass-driver', erekirBlock: 'payload-mass-driver' },
  ],
  units: [
    { id: 'ground', label: 'Наземные юниты', block: 'ground-factory', erekirBlock: 'tank-fabricator' },
    { id: 'air', label: 'Воздушные юниты', block: 'air-factory', erekirBlock: 'ship-fabricator' },
    { id: 'naval', label: 'Морские юниты', block: 'naval-factory', erekirBlock: 'mech-fabricator' },
  ],
  logic: [
    { id: 'processor', label: 'Контроллер', block: 'micro-processor', erekirBlock: 'micro-processor' },
    { id: 'display', label: 'Информационная панель', block: 'logic-display', erekirBlock: 'logic-display' },
    { id: 'switch', label: 'Система переключателей', block: 'switch', erekirBlock: 'switch' },
  ],
  campaign: [
    { id: 'launch', label: 'Пусковой узел', block: 'launch-pad', erekirBlock: 'launch-pad' },
    { id: 'accelerator', label: 'Межпланетный запуск', block: 'interplanetary-accelerator', erekirBlock: 'interplanetary-accelerator' },
  ],
};

export const directionLabels = Object.values(directionMeta);
export const typeLabels = {
  all: 'Всё содержимое',
  block: 'Блоки',
  item: 'Предметы',
  liquid: 'Жидкости',
  unit: 'Юниты',
};

export function getBlock(id) {
  return blockById.get(id) ?? buildableBlocks[0];
}

export function getStageLabel(stage) {
  return stageMeta[stage]?.longLabel ?? stageMeta.early.longLabel;
}

export function getPlanetLabel(planet) {
  if (planet === 'erekir') return 'Эрекир';
  if (planet === 'both') return 'Обе планеты';
  return 'Серпуло';
}
