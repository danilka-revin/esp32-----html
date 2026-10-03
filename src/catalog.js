import rawCatalog from './catalog.json' with { type: 'json' };
import facts from './block-facts.json' with { type: 'json' };

const catalog = rawCatalog.map(entry => entry.type === 'block' ? { ...entry, size: facts[entry.id]?.size ?? entry.size } : entry);

export const gameCatalog = catalog;
export const gameBlocks = catalog.filter((entry) => entry.type === 'block');
export const allBuildableBlocks = gameBlocks.filter((entry) => entry.buildable);
// The editor's default palette is campaign-safe: sandbox/editor-only tools stay
// in the catalog, but cannot accidentally get into a normal exported blueprint.
export const buildableBlocks = gameBlocks.filter((entry) => entry.campaignBuildable ?? entry.buildable);
export const materials = catalog.filter((entry) => entry.type === 'item');
export const visibleMaterials = materials.filter((item) => !item.hidden);
export const liquids = catalog.filter((entry) => entry.type === 'liquid');
export const units = catalog.filter((entry) => entry.type === 'unit');
// Keep dimensions available even for imported sandbox/environment blocks.
export const blockById = new Map(gameBlocks.map((block) => [block.id, block]));
export const campaignBlockById = new Map(buildableBlocks.map((block) => [block.id, block]));
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
  { id: 'campaign', label: 'Кампания', icon: '✦', hint: 'Экспорт и межпланетные блоки' },
  { id: 'sandbox', label: 'Песочница', icon: '∞', hint: 'Тестовые блоки' },
  { id: 'surface', label: 'Поверхности', icon: '▧', hint: 'Покрытия и ландшафт' },
  { id: 'ore', label: 'Руды', icon: '◈', hint: 'Рудные залежи' },
  { id: 'boulder', label: 'Обломки', icon: '⬢', hint: 'Валуны и кристаллы' },
  { id: 'item', label: 'Предметы', icon: '◈', hint: 'Материалы игры' },
  { id: 'unit', label: 'Юниты', icon: '⬟', hint: 'Боевые и вспомогательные юниты' },
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

const fixedProductsByDirection = {
  mining: [
    { id: 'copper', label: 'Медь', block: 'mechanical-drill', planets: ['serpulo'] },
    { id: 'lead', label: 'Свинец', block: 'mechanical-drill', planets: ['serpulo'] },
    { id: 'sand', label: 'Песок', block: 'mechanical-drill', erekirBlock: 'cliff-crusher', planets: ['serpulo', 'erekir'] },
    { id: 'coal', label: 'Уголь', block: 'mechanical-drill', planets: ['serpulo'] },
    { id: 'scrap', label: 'Металлолом', block: 'mechanical-drill', planets: ['serpulo'] },
    { id: 'titanium', label: 'Титан', block: 'pneumatic-drill', planets: ['serpulo'] },
    { id: 'thorium', label: 'Торий', block: 'laser-drill', erekirBlock: 'large-plasma-bore', planets: ['serpulo', 'erekir'] },
    { id: 'beryllium', label: 'Бериллий', erekirBlock: 'plasma-bore', planets: ['erekir'] },
    { id: 'graphite', label: 'Графит (стеновая руда)', erekirBlock: 'plasma-bore', planets: ['erekir'] },
    { id: 'tungsten', label: 'Вольфрам', erekirBlock: 'large-plasma-bore', planets: ['erekir'] },
  ],
  defense: [
    { id: 'frontline', label: 'Линия фронта', block: 'duo', erekirBlock: 'breach' },
    { id: 'anti-air', label: 'ПВО', block: 'scatter', erekirBlock: 'diffuse' },
    { id: 'heavy', label: 'Тяжёлая оборона', block: 'salvo', erekirBlock: 'titan' },
  ],
  power: [
    { id: 'solar', label: 'Солнечная сеть', block: 'solar-panel', planets: ['serpulo'] },
    { id: 'combustion', label: 'Генераторы на топливе', block: 'combustion-generator', planets: ['serpulo'] },
    { id: 'steam', label: 'Паровая станция', block: 'steam-generator', planets: ['serpulo'] },
    { id: 'thermal', label: 'Тепловая станция', block: 'thermal-generator', erekirBlock: 'turbine-condenser' },
    { id: 'reactor', label: 'Реакторный узел', block: 'thorium-reactor', erekirBlock: 'flux-reactor' },
  ],
  logistics: [
    { id: 'conveyor', label: 'Конвейерная магистраль', block: 'conveyor', erekirBlock: 'duct' },
    { id: 'sort', label: 'Сортировка ресурсов', block: 'inverted-sorter', planets: ['serpulo'] },
    { id: 'driver', label: 'Масс-драйверы', block: 'mass-driver', planets: ['serpulo'] },
  ],
  units: [
    { id: 'ground', label: 'Наземные юниты', erekirLabel: 'Танки (Stell)', block: 'ground-factory', erekirBlock: 'tank-fabricator' },
    { id: 'air', label: 'Воздушные юниты', block: 'air-factory', planets: ['serpulo'] },
    { id: 'naval', label: 'Морские юниты', erekirLabel: 'Корабли (Elude)', block: 'naval-factory', erekirBlock: 'ship-fabricator' },
    { id: 'mech', label: 'Мехи (Merui)', erekirBlock: 'mech-fabricator', planets: ['erekir'] },
  ],
  logic: [
    { id: 'processor', label: 'Контроллер', block: 'micro-processor', erekirBlock: 'micro-processor' },
    { id: 'display', label: 'Информационная панель', block: 'logic-display', erekirBlock: 'large-logic-display' },
    { id: 'switch', label: 'Система переключателей', block: 'switch', erekirBlock: 'message' },
  ],
  campaign: [
    { id: 'launch', label: 'Экспортная площадка', block: 'advanced-launch-pad', planets: ['serpulo'] },
    { id: 'accelerator', label: 'Межпланетный ускоритель', block: 'interplanetary-accelerator', planets: ['serpulo'] },
  ],
};

export const productsByDirection = { ...fixedProductsByDirection, production: [] };
const recipeFacts = facts;
const stageRank = { early: 0, mid: 1, late: 2 };

function recipeMachineCandidates(planet, goal) {
  return buildableBlocks.flatMap((block) => {
    if (block.planet !== 'both' && block.planet !== planet) return [];
    const recipe = recipeFacts[block.id];
    if (!recipe?.output || !recipe.craftTime || !recipe.output[goal]) return [];
    return [{ block, recipe }];
  });
}

function recipeRank({ block, recipe }, stage = 'late') {
  const size = Math.max(1, block.size ?? 1);
  const inputs = Object.keys(recipe.inputs ?? {}).length;
  const liquids = Object.keys(recipe.liquids ?? {}).length;
  const heat = recipe.heatRequirement ?? 0;
  const outputRate = (recipe.output[Object.keys(recipe.output)[0]] ?? 1) * 60 / recipe.craftTime;
  const stagePenalty = stageRank[block.stage] > (stageRank[stage] ?? 2) ? 18 : 0;
  // Prefer small modules, fewer independent feeds, and recipes without liquid
  // or heat dependencies. Throughput is a tie-breaker, not a reason to build a
  // larger footprint when the user asked for a minimal module.
  return size * size * 1.6 + inputs * 1.2 + liquids * 2.2 + (heat > 0 ? 3 : 0)
    + (recipe.power ?? 0) / 240 - Math.min(20, outputRate) * 0.08 + stagePenalty;
}

export function getProductionMachine(planet, goal, stage = 'late') {
  return recipeMachineCandidates(planet, goal)
    .sort((a, b) => recipeRank(a, stage) - recipeRank(b, stage))[0]?.block.id ?? null;
}

export function getProductsForDirection(direction, planet = 'serpulo', stage = 'late') {
  if (direction !== 'production') {
    return (fixedProductsByDirection[direction] ?? []).filter((option) => {
      if (option.planets && !option.planets.includes(planet)) return false;
      const blockId = planet === 'erekir' ? (option.erekirBlock ?? option.block) : (option.block ?? option.erekirBlock);
      const block = blockById.get(blockId);
      return block?.campaignBuildable && (block.planet === 'both' || block.planet === planet);
    }).map((option) => (planet === 'erekir' && option.erekirLabel ? { ...option, label: option.erekirLabel } : option));
  }
  const outputs = new Set();
  for (const block of buildableBlocks) {
    if (block.planet !== 'both' && block.planet !== planet) continue;
    for (const id of Object.keys(recipeFacts[block.id]?.output ?? {})) outputs.add(id);
  }
  return [...outputs].map((id) => {
    const item = itemById.get(id);
    const block = getProductionMachine(planet, id, stage);
    return block ? { id, label: item?.name ?? id, block, erekirBlock: planet === 'erekir' ? block : null } : null;
  }).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

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
