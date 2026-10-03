import { blockById, buildableBlocks, campaignBlockById, getProductionMachine, itemById } from './catalog.js';
import facts from './block-facts.json' with { type: 'json' };
import { GAME_VERSION } from './game-version.js';
import { footprint } from './geometry.js';
import { analyzeFlow } from './flow.js';
import { stageTier, techTier } from './gen/profile.js';
export { facts as blockFacts, footprint };

export function trimLayout(scheme) {
  if (!scheme.tiles.length) return scheme;
  const rects = scheme.tiles.map(footprint);
  const x = Math.min(...rects.map(r => r.startX));
  const y = Math.min(...rects.map(r => r.startY));
  return {
    ...scheme,
    width: Math.max(...rects.map(r => r.endX)) - x + 1,
    height: Math.max(...rects.map(r => r.endY)) - y + 1,
    // Relative block configs are preserved; do not relocate individual machines.
    tiles: scheme.tiles.map(t => ({ ...t, x: t.x - x, y: t.y - y })),
    ...(scheme.inlets ? { inlets: scheme.inlets.map(inlet => ({ ...inlet, x: inlet.x - x, y: inlet.y - y })) } : {}),
    ...(scheme.outlets ? { outlets: scheme.outlets.map(outlet => ({ ...outlet, x: outlet.x - x, y: outlet.y - y })) } : {}),
  };
}

const planetIds = ['serpulo', 'erekir'];
export const productionMachines = Object.fromEntries(planetIds.map(planet => {
  const products = new Set();
  for (const block of buildableBlocks) {
    if (block.planet !== 'both' && block.planet !== planet) continue;
    const output = facts[block.id]?.output ?? {};
    // A one-product module has a clear output lane. Multi-output recipes remain
    // available in the full catalog but are intentionally not called minimal.
    if (Object.keys(output).length === 1) products.add(Object.keys(output)[0]);
  }
  return [planet, Object.fromEntries([...products].map(id => [id, getProductionMachine(planet, id, 'late')]).filter(([, machine]) => machine))];
}));

const label = id => itemById.get(id)?.name ?? id;
const stageRank = { early: 0, mid: 1, late: 2 };
const sideOrderByVariant = [
  { output: 'east', inputs: ['west', 'south', 'north', 'east'] },
  { output: 'north', inputs: ['south', 'east', 'west', 'north'] },
  { output: 'west', inputs: ['east', 'north', 'south', 'west'] },
];
const capacities = {
  conveyor: 4.2, 'titanium-conveyor': 11, 'plastanium-conveyor': 40,
  duct: 15, 'surge-conveyor': 30,
};

function sidePorts(rect, side, role = 'input') {
  const ports = [];
  const centerIndex = Math.floor((rect.size - 1) / 2);
  for (let offset = 0; offset < rect.size; offset += 1) {
    const index = (centerIndex + offset) % rect.size;
    if (side === 'west') ports.push({ x: rect.startX - 1, y: rect.startY + index, rotation: role === 'input' ? 0 : 2, side });
    if (side === 'east') ports.push({ x: rect.endX + 1, y: rect.startY + index, rotation: role === 'input' ? 2 : 0, side });
    if (side === 'south') ports.push({ x: rect.startX + index, y: rect.startY - 1, rotation: role === 'input' ? 1 : 3, side });
    if (side === 'north') ports.push({ x: rect.startX + index, y: rect.endY + 1, rotation: role === 'input' ? 3 : 1, side });
  }
  return ports;
}

function portKey(port) { return `${port.x}:${port.y}`; }

function allPorts(rect, preferredSides) {
  const ports = [];
  for (const side of preferredSides) {
    for (const port of sidePorts(rect, side)) {
      if (!ports.some(existing => portKey(existing) === portKey(port))) ports.push(port);
    }
  }
  return ports;
}

function chooseBelt(planet, rate, stage = 'late') {
  const options = planet === 'erekir'
    ? [['duct', 15], ['surge-conveyor', 30]]
    : [['conveyor', 4.2], ['titanium-conveyor', 11], ['plastanium-conveyor', 40]];
  const available = options.filter(([id]) => {
    const block = campaignBlockById.get(id);
    return block && (stageRank[block.stage] ?? 0) <= (stageRank[stage] ?? 2);
  });
  return (available.find(([, capacity]) => capacity >= rate) ?? available.at(-1) ?? options[0])[0];
}

function recipeFor(machine) { return facts[machine] ?? null; }

function inputPortPlan(machineTile, recipe, settings, variant) {
  const rect = footprint(machineTile);
  const layout = sideOrderByVariant[variant % sideOrderByVariant.length];
  const inputCandidates = allPorts(rect, layout.inputs);
  const outputCandidate = sidePorts(rect, layout.output, 'output')[0];
  const used = new Set([portKey(outputCandidate)]);
  const inputPorts = [];
  for (const [id, amount] of Object.entries(recipe.inputs ?? {})) {
    const port = inputCandidates.find(candidate => !used.has(portKey(candidate)));
    if (!port) break;
    used.add(portKey(port));
    const rate = amount * 60 / recipe.craftTime;
    inputPorts.push({ ...port, id, rate, block: chooseBelt(settings.planet, rate, settings.stage) });
  }
  const outputRate = Object.values(recipe.output ?? {})[0] * 60 / recipe.craftTime;
  const outputs = [{ ...outputCandidate, id: Object.keys(recipe.output)[0], rate: outputRate, block: chooseBelt(settings.planet, outputRate, settings.stage) }];
  const freePorts = inputCandidates.filter(candidate => !used.has(portKey(candidate)));
  const liquidPorts = [];
  for (const [id, rate] of Object.entries(recipe.liquids ?? {})) {
    const port = freePorts.find(candidate => !used.has(portKey(candidate)));
    if (!port) break;
    used.add(portKey(port));
    liquidPorts.push({ ...port, id, rate, block: settings.planet === 'erekir' ? 'reinforced-conduit' : 'conduit' });
  }
  const powerPort = recipe.power > 0 && settings.includePower
    ? freePorts.find(candidate => !used.has(portKey(candidate))) ?? null
    : null;
  return { rect, outputCandidate, inputPorts, outputs, liquidPorts, powerPort, missingInputs: inputPorts.length !== Object.keys(recipe.inputs ?? {}).length };
}

function productName(goal) { return itemById.get(goal)?.name ?? goal; }

/** One recipe-aware module. Ports are independent and labelled in the report. */
export function minimalProduction(settings = {}) {
  const machine = getProductionMachine(settings.planet, settings.goal, settings.stage);
  if (!machine) return null;
  const recipe = recipeFor(machine);
  const machineInfo = blockById.get(machine);
  const size = machineInfo?.size ?? 1;
  const offset = Math.floor((size - 1) / 2);
  const machineTile = { id: machine, x: 1 + offset, y: 1 + offset, rotation: 0, config: null };
  const variant = Math.abs(Number(settings.variant) || 0) % sideOrderByVariant.length;
  const plan = inputPortPlan(machineTile, recipe, settings, variant);
  const tiles = [machineTile];
  const add = (id, port, config = null) => {
    if (id && port && campaignBlockById.has(id)) tiles.push({ id, x: port.x, y: port.y, rotation: port.rotation, config });
  };

  plan.inputPorts.forEach(port => add(port.block, port));
  plan.liquidPorts.forEach(port => add(port.block, port));
  plan.outputs.forEach(port => add(port.block, port));
  if (plan.powerPort) add(settings.planet === 'erekir' ? 'beam-node' : 'power-node', plan.powerPort);

  // Optional campaign flow: Serpulo exports the produced item automatically
  // after the player assigns a destination in the sector screen.
  if (settings.campaignLink && settings.planet === 'serpulo') {
    const output = plan.outputCandidate;
    const outputSide = sideOrderByVariant[variant].output;
    const padSize = blockById.get('advanced-launch-pad')?.size ?? 4;
    const padAnchor = outputSide === 'east' ? { x: output.x + Math.floor((padSize + 1) / 2), y: output.y + 1 }
      : outputSide === 'north' ? { x: output.x + 1, y: output.y + Math.floor((padSize + 1) / 2) }
        : outputSide === 'west' ? { x: output.x - Math.ceil((padSize + 1) / 2), y: output.y + 1 }
          : { x: output.x + 1, y: output.y - Math.ceil((padSize + 1) / 2) };
    const pad = { id: 'advanced-launch-pad', ...padAnchor, rotation: 0, config: null };
    tiles.push(pad);
    const padRect = footprint(pad);
    const centerX = padRect.startX + Math.floor((padRect.size - 1) / 2);
    const centerY = padRect.startY + Math.floor((padRect.size - 1) / 2);
    const auxiliaryPorts = outputSide === 'east' || outputSide === 'west'
      ? [{ x: centerX, y: padRect.endY + 1, rotation: 0, block: 'conduit' }, { x: centerX, y: padRect.startY - 1, rotation: 0, block: 'power-node' }]
      : [{ x: padRect.endX + 1, y: centerY, rotation: 0, block: 'conduit' }, { x: padRect.startX - 1, y: centerY, rotation: 0, block: 'power-node' }];
    auxiliaryPorts.forEach(port => add(port.block, port));
  }

  // The module's lanes are open on purpose: they connect to supplies outside the blueprint.
  const inlets = [
    ...plan.inputPorts.map(port => ({ x: port.x, y: port.y, kind: 'item', id: port.id })),
    ...plan.liquidPorts.map(port => ({ x: port.x, y: port.y, kind: 'liquid', id: port.id })),
    ...(plan.powerPort ? [{ x: plan.powerPort.x, y: plan.powerPort.y, kind: 'power', id: null }] : []),
  ];
  const outlets = plan.outputs.map(port => ({ x: port.x, y: port.y, kind: 'item', id: port.id }));

  const moduleName = productName(settings.goal);
  const exported = Boolean(settings.campaignLink && settings.planet === 'serpulo');
  const name = `${moduleName} · ${exported ? 'экспорт' : 'минимальный модуль'}`;
  const description = exported
    ? `Одна фабрика и пусковая площадка Mindustry ${GAME_VERSION}. Назначь сектор-получатель на карте кампании; площадка отправляет накопленный груз автоматически.`
    : `Одна фабрика, раздельные входы и внешние линии сырья/энергии. Mindustry ${GAME_VERSION}.`;
  return trimLayout({
    width: 2 * size + 4, height: 2 * size + 4, tiles, name, description, inlets, outlets,
    settings: { ...settings, processorControl: false, supplyMode: 'external', minimal: true },
    tags: {
      name, planet: settings.planet, direction: 'production', goal: settings.goal,
      minimal: 'true', supplyMode: 'external', processorControl: 'false',
      campaignLink: String(exported), description,
      portInputs: Object.keys(recipe.inputs ?? {}).join(','),
    },
  });
}

export function analyzeMechanics(scheme) {
  const warnings = new Set();
  const requirements = [];
  let power = 0;
  const costs = new Map();
  const lateBlocks = new Set();
  let unknownCosts = 0;

  for (const tile of scheme.tiles) {
    const fact = facts[tile.id];
    const block = blockById.get(tile.id);
    if (!fact?.cost) unknownCosts++;
    for (const [id, amount] of Object.entries(fact?.cost ?? {})) costs.set(id, (costs.get(id) ?? 0) + amount);
    power += fact?.power ?? 0;
    if (fact?.output && fact.craftTime) {
      const rate = 60 / fact.craftTime;
      requirements.push({
        tile,
        inputs: Object.entries(fact.inputs ?? {}).map(([id, amount]) => ({ id, rate: amount * rate })),
        output: Object.entries(fact.output).map(([id, amount]) => ({ id, rate: amount * rate })),
        liquids: fact.liquids ?? {}, heat: fact.heatRequirement ?? 0,
      });
    }
    // The catalog's stage labels are hand-made; the materials a block costs tell reliably how far into the game it is.
    if (block && techTier(tile.id, scheme.settings?.planet === 'erekir' ? 'erekir' : 'serpulo') > stageTier(scheme.settings?.stage)) lateBlocks.add(block.name);
    if (/drill|bore|crusher/.test(tile.id)) warnings.add('Добыча зависит от карты: проверь руду/стену под буром, покрытие и требуемый атрибут поверхности.');
    if (/thermal-generator|condenser/.test(tile.id)) warnings.add('Тепловые генераторы и конденсаторы требуют подходящей поверхности; выход зависит от карты.');
    if (/reactor/.test(tile.id)) warnings.add('Реактор: подключи топливо, охлаждение и пусковое питание по требованиям блока.');
    if (/factory|fabricator|reconstructor|assembler/.test(tile.id)) warnings.add('Юниты: проверь план сборки, ингредиенты, жидкости и свободный грузовой выход.');
    if (tile.id === 'advanced-launch-pad') warnings.add('Для экспорта назначь сектор-получатель в кампании; пусковая площадка отправляет накопившиеся предметы автоматически. Проверь масло и питание.');
    if (tile.id === 'landing-pad') warnings.add('Посадочная площадка принимает экспорт выбранного предмета: настрой её фильтр после вставки и направь импорт в конвейер.');
  }

  if (lateBlocks.size) {
    const names = [...lateBlocks].slice(0, 4).map(name => `«${name}»`).join(', ');
    const rest = lateBlocks.size > 4 ? ` и ещё ${lateBlocks.size - 4}` : '';
    const verb = lateBlocks.size === 1 ? 'открывается и строится' : 'открываются и строятся';
    warnings.add(`Для выбранного этапа это дорого: ${names}${rest} обычно ${verb} позже; проверь исследования и ресурсы сектора.`);
  }
  const flow = analyzeFlow(scheme);
  const minimal = scheme.settings?.minimal && scheme.settings?.supplyMode === 'external';
  if (minimal) {
    warnings.add('Минимальный режим — один рецепт и внешние линии. Сырьё/жидкости подаются напрямую к отмеченным соседним портам.');
    if (!requirements.length) warnings.add('В модуле нет поддерживаемой фабрики: восстанови её или пересобери схему.');
    for (const requirement of requirements) {
      const recipe = facts[requirement.tile.id];
      const variant = Math.abs(Number(scheme.settings?.variant) || 0) % sideOrderByVariant.length;
      const plan = inputPortPlan(requirement.tile, recipe, scheme.settings ?? {}, variant);
      for (const port of plan.inputPorts) {
        const lane = scheme.tiles.find(tile => tile.x === port.x && tile.y === port.y);
        const capacity = capacities[lane?.id] ?? 0;
        if (capacity < port.rate || lane?.rotation !== port.rotation) {
          warnings.add(`Вход ${label(port.id)}: проверь полосу и направление. Нужно ${port.rate.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} предмета/с.`);
        }
      }
      if (plan.missingInputs) warnings.add('Для рецепта не хватило отдельных портов на входы: фабрику/планировку нужно увеличить.');
      for (const port of plan.liquidPorts) {
        if (!scheme.tiles.some(tile => tile.x === port.x && tile.y === port.y && /conduit/.test(tile.id))) {
          warnings.add(`Подай ${label(port.id)} (${port.rate.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}/с) в трубу рядом с фабрикой.`);
        }
      }
      if (recipe?.heatRequirement) warnings.add(`Подведи тепло: требуется ${recipe.heatRequirement} ед. на свободную грань фабрики. Тепло не заменяется электричеством.`);
      if (recipe?.power && scheme.settings?.includePower && !plan.powerPort) warnings.add('Не осталось свободного порта для силового узла: подключи фабрику к внешней сети напрямую.');
      if (recipe?.power && !scheme.settings?.includePower) warnings.add(`Подключи внешнюю энергосеть: до ${recipe.power.toLocaleString('ru-RU')} ед./с при базовой скорости.`);
    }
    if (scheme.settings?.campaignLink && scheme.settings?.planet === 'serpulo') {
      warnings.add('Экспорт — не автономный: площадке нужны масло и энергия, а сектор-получатель задаётся уже в игре.');
    } else {
      warnings.add('Один модуль, без ядра и склада. Это минимум среди поддерживаемых одиночных рецептов, не доказательство глобального оптимума.');
    }
  } else if (scheme.tiles.length) {
    warnings.add(flow.errors
      ? `Статическая проверка нашла ошибки потоков: ${flow.errors} (см. раздел «Проверка схемы»). Исправь их или перегенерируй схему.`
      : `Статическая проверка Mindustry ${GAME_VERSION}: ленты, подача ингредиентов и боеприпасов, питание и жидкости сходятся. Это не игровая симуляция: рельеф карты и баланс производительности проверь в игре.`);
    if (power && flow.warnings) warnings.add('Проверь мощность: дальность силовых связей и покрытие потребителей отмечены в разделе «Проверка схемы».');
    if (scheme.settings?.planet === 'erekir') warnings.add('Эрекир: ядро нельзя разгружать напрямую; лучевые узлы соединяются по прямой.');
    if (scheme.settings?.direction === 'production' && !productionMachines[scheme.settings?.planet]?.[scheme.settings?.goal]) {
      warnings.add('Для выбранного продукта нет подтверждённого одно-продуктового рецепта на этой планете; схема может быть неполной.');
    }
  }
  return { warnings: [...warnings], requirements, power, costs, unknownCosts, flow };
}
