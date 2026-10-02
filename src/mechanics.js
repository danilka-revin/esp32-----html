import { blockById, itemById } from './catalog.js';
import facts from './block-facts.json' with { type: 'json' };
export { facts as blockFacts };

// Mindustry Block.sizeOffset: -((size - 1) / 2), integer division.
export function footprint(tile) {
  const size = blockById.get(tile.id)?.size ?? 1;
  const startX = tile.x - Math.floor((size - 1) / 2);
  const startY = tile.y - Math.floor((size - 1) / 2);
  return { startX, startY, endX: startX + size - 1, endY: startY + size - 1, size };
}
export function trimLayout(scheme) {
  if (!scheme.tiles.length) return scheme;
  const rects = scheme.tiles.map(footprint);
  const x = Math.min(...rects.map(r => r.startX));
  const y = Math.min(...rects.map(r => r.startY));
  return { ...scheme, width: Math.max(...rects.map(r => r.endX)) - x + 1,
    height: Math.max(...rects.map(r => r.endY)) - y + 1,
    // Relative block configs are preserved; do not relocate individual machines.
    tiles: scheme.tiles.map(t => ({ ...t, x: t.x - x, y: t.y - y })) };
}
export const productionMachines = {
  serpulo: { silicon: 'silicon-smelter', graphite: 'graphite-press', metaglass: 'kiln', plastanium: 'plastanium-compressor', 'surge-alloy': 'surge-smelter', 'phase-fabric': 'phase-weaver' },
  erekir: { silicon: 'silicon-arc-furnace', carbide: 'carbide-crucible', 'surge-alloy': 'surge-crucible', 'phase-fabric': 'phase-synthesizer' },
};
const label = id => itemById.get(id)?.name ?? id;

// A single-machine module, not a self-sufficient base. Separate adjacent lanes
// eliminate mixed-item router starvation. Every external dependency is exposed.
export function minimalProduction(settings) {
  const machine = productionMachines[settings.planet]?.[settings.goal];
  if (!machine) return null;
  const recipe = facts[machine];
  const size = blockById.get(machine).size;
  const offset = Math.floor((size - 1) / 2);
  const tiles = [{ id: machine, x: 1 + offset, y: 1 + offset, rotation: 0, config: null }];
  const beltFor = rate => settings.planet === 'erekir' ? 'duct' : rate > 4.2 ? 'titanium-conveyor' : 'conveyor';
  const add = (id, x, y, rotation = 0) => tiles.push({ id, x, y, rotation, config: null });
  // Y in .msch grows upwards. Rotation 0=east, 1=north, 2=west, 3=south.
  Object.entries(recipe.inputs).forEach(([id, amount], i) => {
    const belt = beltFor(amount * 60 / recipe.craftTime);
    if (i < size) add(belt, 0, 1 + i, 0);
    else add(belt, 1 + i - size, 0, 1);
  });
  add(beltFor(Object.values(recipe.output)[0] * 60 / recipe.craftTime), size + 1, 1, 0);
  if (recipe.liquids) add(settings.planet === 'erekir' ? 'reinforced-conduit' : 'conduit', 1, size + 1, 3);
  if (recipe.power && settings.includePower) add(settings.planet === 'erekir' ? 'beam-node' : 'power-node', size, size + 1);
  // Heat is intentionally an external edge, not a fictitious power connection.
  const name = `${label(settings.goal)} · минимальный модуль`;
  return trimLayout({ width: size + 2, height: size + 2, tiles, name,
    description: 'Одна фабрика, раздельные входы, внешний источник питания и сырья. Mindustry v146.',
    settings: { ...settings, processorControl: false, supplyMode: 'external' },
    tags: { name, planet: settings.planet, direction: 'production', goal: settings.goal,
      minimal: 'true', supplyMode: 'external', processorControl: 'false', description: 'Минимальный модуль с внешним снабжением; условия подключения указаны в редакторе.' } });
}

export function analyzeMechanics(scheme) {
  const warnings = new Set();
  const requirements = [];
  let power = 0;
  const costs = new Map();
  let unknownCosts = 0;
  for (const tile of scheme.tiles) {
    const f = facts[tile.id];
    const stages = { early: 0, mid: 1, late: 2 };
    if (stages[blockById.get(tile.id)?.stage] > stages[scheme.settings?.stage]) warnings.add('Часть блоков относится к более позднему этапу: проверьте исследования и строительные ресурсы. Рецепт не заменяется несовместимой фабрикой.');
    if (!f?.cost) unknownCosts++;
    for (const [id, amount] of Object.entries(f?.cost ?? {})) costs.set(id, (costs.get(id) ?? 0) + amount);
    power += f?.power ?? 0;
    if (f?.output && f.craftTime && f.inputs) {
      const rate = 60 / f.craftTime;
      requirements.push({ tile, inputs: Object.entries(f.inputs).map(([id, amount]) => ({ id, rate: amount * rate })),
        output: Object.entries(f.output).map(([id, amount]) => ({ id, rate: amount * rate })),
        liquids: f.liquids ?? {}, heat: f.heatRequirement ?? 0 });
    }
    if (/drill|bore/.test(tile.id)) warnings.add('Добыча зависит от руды, её твёрдости, площади покрытия и ориентации бура на карте.');
    if (/thermal-generator|condenser/.test(tile.id)) warnings.add('Тепловые генераторы/конденсаторы требуют подходящей поверхности; выход зависит от карты.');
    if (/reactor/.test(tile.id)) warnings.add('Реактор: подключите топливо, охлаждение и пусковое питание по требованиям блока.');
    if (/factory|fabricator|reconstructor|assembler/.test(tile.id)) warnings.add('Юниты: проверьте план сборки, все ингредиенты, жидкости и путь грузового выхода.');
  }
  const minimal = scheme.settings?.minimal && scheme.settings?.supplyMode === 'external';
  if (minimal) {
    warnings.add('Внешнее снабжение: входы слева снизу вверх в порядке рецепта (четвёртый — снизу фабрики). Выход справа должен быть свободен.');
    if (!requirements.length) warnings.add('В модуле нет поддерживаемой фабрики: восстановите её или пересоберите схему.');
    for (const requirement of requirements) {
      const r = footprint(requirement.tile);
      requirement.inputs.forEach((input, i) => {
        const x = i < r.size ? r.startX - 1 : r.startX + i - r.size;
        const y = i < r.size ? r.startY + i : r.startY - 1;
        const lane = scheme.tiles.find(t => t.x === x && t.y === y);
        const capacity = { conveyor: 4.2, 'titanium-conveyor': 11, duct: 15 }[lane?.id] ?? 0;
        if (capacity < input.rate || lane?.rotation !== (i < r.size ? 0 : 1)) warnings.add(`Вход ${label(input.id)}: отсутствует подходящий конвейер, неверное направление или недостаточная пропускная способность.`);
      });
      const output = scheme.tiles.find(t => t.x === r.endX + 1 && t.y === r.startY);
      if (!['conveyor', 'titanium-conveyor', 'duct'].includes(output?.id) || output.rotation !== 0) warnings.add('Выход фабрики изменён: проверьте отвод готового продукта.');
    }
    if (power) warnings.add(`Подключите внешнюю энергосеть: потребление до ${power.toLocaleString('ru-RU')} ед./с при базовой скорости. Генератор не включён.`);
    if (requirements.some(r => Object.keys(r.liquids).length)) warnings.add('Подайте указанную жидкость в трубу над фабрикой.');
    if (requirements.some(r => r.heat)) warnings.add('Подведите тепло к свободной нижней грани фабрики. Тепло не заменяется электричеством.');
    warnings.add('Один производственный модуль, без ядра, защиты, склада и MLOG. Минимум среди этого шаблона, не доказанный глобальный оптимум.');
  } else if (scheme.tiles.length) {
    warnings.add('Эскиз: работоспособность всех маршрутов и баланс снабжения не подтверждены. Проверяйте в игре; это не симулятор Mindustry.');
    if (power) warnings.add('Проверьте мощность генерации, дальность силовых связей и подключение каждого потребителя.');
    if (scheme.settings?.planet === 'erekir') warnings.add('Эрекир: ядро не разгружается; нужны внешние ресурсы. Лучевые узлы соединяются по прямой.');
    if (scheme.settings?.direction === 'production' && !productionMachines[scheme.settings?.planet]?.[scheme.settings?.goal]) warnings.add('Для выбранного продукта на этой планете нет поддерживаемого рецепта генерации.');
  }
  return { warnings: [...warnings], requirements, power, costs, unknownCosts };
}
