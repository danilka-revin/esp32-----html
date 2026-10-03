import { footprint, minimalProduction, trimLayout } from './mechanics.js';
import { blockById, getProductsForDirection } from './catalog.js';
import { GAME_VERSION } from './game-version.js';
import { analyzeFlow, describeBlock } from './flow.js';
import { Frame, normalizeSettings } from './gen/frame.js';
import { canvasPresets, initialSettings, supplyModes } from './gen/settings.js';
import { buildMining } from './gen/mining.js';
import { buildDefense } from './gen/defense.js';
import { buildProduction } from './gen/production.js';
import { buildPowerPlant } from './gen/powerplant.js';
import { buildLogistics } from './gen/logistics.js';
import { buildUnits } from './gen/units.js';
import { buildLogic } from './gen/logicdemo.js';
import { buildCampaign } from './gen/campaign.js';
import { getStageLabel } from './catalog.js';

export { canvasPresets, initialSettings, supplyModes };

export function blockRect(tile) {
  return footprint(tile);
}

export function tileAtCell(tiles, x, y) {
  return tiles.find((tile) => {
    const rect = footprint(tile);
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
    const rect = footprint(tile);
    return left <= rect.endX && right >= rect.startX && top <= rect.endY && bottom >= rect.startY;
  });
}

const directionNames = {
  mining: 'добыча', production: 'производство', defense: 'оборона', power: 'энергетика',
  logistics: 'логистика', units: 'юниты', logic: 'логика', campaign: 'кампания',
};

/**
 * What a blueprint of each direction must contain at the very least. A builder that runs out of room used to return a bare
 * core without a word; now the gap is reported through `problems`, so the picker and the tests can see it.
 */
const essentials = {
  mining: { has: id => describeBlock(id).kind === 'drill', text: 'Не поместился ни один бур: увеличь холст или уменьши плотность.' },
  production: { has: id => describeBlock(id).kind === 'crafter', text: 'Не поместилась ни одна фабрика: увеличь холст.' },
  defense: { has: id => Boolean(describeBlock(id).turret), text: 'Не поместилась ни одна турель: увеличь холст или уменьши плотность.' },
  power: { has: id => Boolean(describeBlock(id).generator), text: 'Не поместился ни один генератор: увеличь холст.' },
  units: { has: id => Boolean(describeBlock(id).factory), text: 'Не поместился ни один завод юнитов: увеличь холст.' },
  logic: { has: id => /processor/.test(id), text: 'Не поместился процессор: увеличь холст.' },
  campaign: { has: id => /landing-pad|launch-pad|accelerator/.test(id), text: 'Не поместилась площадка или ускоритель: увеличь холст.' },
  logistics: { has: id => /conveyor|duct|bridge|router|sorter|junction|gate/.test(id), text: 'Не поместился ни один элемент транспортной линии: увеличь холст.' },
};

/** The sentence to show when `tiles` lack what a `direction` blueprint is about; null when everything essential is there. */
export function missingEssential(direction, tiles) {
  const essential = essentials[direction];
  return essential && !tiles.some(tile => essential.has(tile.id)) ? essential.text : null;
}

/**
 * A blueprint changed by hand is judged by the live flow check. The generator's own list of things it could not build
 * describes the original result only, so it would stay on screen forever after the player fixed the gap.
 */
export function withManualEdit(previous, next) {
  return next.tiles === previous.tiles || !next.problems?.length ? next : { ...next, problems: [] };
}

const builders = {
  mining: buildMining,
  defense: buildDefense,
  production: buildProduction,
  power: buildPowerPlant,
  logistics: buildLogistics,
  units: buildUnits,
  logic: buildLogic,
  campaign: buildCampaign,
};

function describe(settings, directionLabel) {
  const stageLabel = getStageLabel(settings.stage);
  const supplyLabel = supplyModes.find((mode) => mode.id === settings.supplyMode)?.label ?? 'От ядра';
  const supplyDescription = ['production', 'defense', 'units', 'logistics'].includes(settings.direction) ? ` · снабжение: ${supplyLabel.toLowerCase()}` : '';
  return `${directionLabel} · ${stageLabel}${supplyDescription} · ванильные блоки Mindustry ${GAME_VERSION}`;
}

export function generateLayout(input = {}) {
  const settings = normalizeSettings(input);
  if ((settings.minimal || settings.campaignLink) && settings.direction === 'production') {
    const module = minimalProduction(settings);
    if (module) return module;
  }
  const builder = builders[settings.direction];
  if (!builder) throw new Error(`Неизвестное направление «${settings.direction}».`);
  const options = getProductsForDirection(settings.direction, settings.planet, settings.stage);
  // An outdated goal (for example after switching planet) falls back to the first one the direction offers.
  const goalOption = options.find(option => option.id === settings.goal) ?? options[0] ?? null;
  const frame = new Frame(goalOption ? { ...settings, goal: goalOption.id } : settings);
  if (!options.length) {
    // The direction does not exist on this planet (for example logic on Erekir): keep a valid core-only blueprint.
    frame.placeCore();
    frame.fail(`Для этой планеты нет поддержанной схемы «${directionNames[settings.direction] ?? settings.direction}».`);
    return trimLayout(frame.scheme({
      name: directionNames[settings.direction] ?? 'Схема', description: describe(settings, directionNames[settings.direction] ?? 'Mindustry'),
      direction: settings.direction, goalId: settings.goal,
    }));
  }
  const info = builder(frame) ?? {};
  const missing = missingEssential(settings.direction, frame.board.tiles);
  if (missing) frame.fail(missing);
  const goal = options.find((option) => option.id === (info.goalId ?? settings.goal)) ?? null;
  const scheme = frame.scheme({
    name: info.label ?? goal?.label ?? settings.goal,
    description: describe(settings, directionNames[settings.direction] ?? 'Mindustry'),
    direction: settings.direction,
    goalId: info.goalId ?? goal?.id ?? settings.goal,
  });
  return trimLayout(scheme);
}

const signature = scheme => scheme.tiles.map(tile => `${tile.id}:${tile.x}:${tile.y}:${tile.rotation}:${JSON.stringify(tile.config ?? null)}`).join('|');

/** Higher is better: valid flows first, then fewer open questions, then compactness. */
export function scoreScheme(scheme, analysis = analyzeFlow(scheme)) {
  const problems = scheme.problems?.length ?? 0;
  const area = scheme.width * scheme.height;
  return Math.round(10000 - analysis.errors * 1500 - problems * 2500 - analysis.warnings * 120 - scheme.tiles.length * 2 - area * 0.5);
}

const variantTexts = {
  mining: [
    ['Магистраль', 'Один сборный конвейер в ядро, буры по обе стороны.'],
    ['Гребёнка', 'Вертикальные ветки сходятся в магистраль: больше буров в высоком поле.'],
    ['Двойная магистраль', 'Две магистрали с общим средним рядом буров — максимум с одной стороны ядра.'],
  ],
  production: [
    ['Компактная', 'Разгрузчики стыкуются с ядром и фабрикой, ленты не нужны; для Эрекира — контейнер-хаб.'],
    ['Выделенные линии', 'Каждый ингредиент идёт по своей ленте к фабрике, продукт собирает общая магистраль.'],
    ['Линии в шахматном порядке', 'Те же линии, но фабрики стоят в разных колонках — больше места для лент и сервиса.'],
  ],
  defense: [
    ['Вертикальная линия', 'Турели парами по обе стороны подающей линии, стена спереди.'],
    ['Две линии в глубину', 'Вторая линия турелей получает боеприпас из первого узла — оборона эшелонами.'],
    ['Горизонтальная батарея', 'Подающая линия идёт вперёд от ядра; турели стоят вдоль неё.'],
  ],
  power: [
    ['Основной узел', 'Генераторы собраны вокруг одной подачи топлива / сплошным блоком.'],
    ['Растянутая схема', 'Генераторы вдоль линии подачи или лентой: удобно при вытянутом участке.'],
    ['Две колонки', 'Генераторы в двух группах: проще расширять и обслуживать.'],
  ],
  logistics: [
    ['Базовый узел', 'Основной вариант транспортного узла.'],
    ['Зеркальный', 'Ветки и узлы отражены относительно магистрали; для магистрали — транзитная линия через перекрёсток.'],
    ['С мостом / растянутый', 'Мост перепрыгивает препятствие либо узлы разнесены дальше друг от друга.'],
  ],
  units: [
    ['Цепочка вдоль ядра', 'Блоки стоят вплотную: юнит едет из фабрики в реконструкторы.'],
    ['Зеркально', 'Та же цепочка с подачей снизу — другая сторона ядра остаётся свободной.'],
    ['С грузовыми конвейерами', 'Между блоками стоят грузовые конвейеры: удобнее обслуживать и расширять.'],
  ],
  logic: [
    ['Рядом с ядром', 'Процессор и связанные блоки стоят у ядра.'],
    ['Выше ядра', 'Тот же набор блоков, сдвинутый вверх.'],
    ['Ниже ядра', 'Тот же набор блоков, сдвинутый вниз.'],
  ],
  campaign: [
    ['Прямая подача', 'Разгрузчик ядра — лента — площадка (или ускоритель) строго по оси.'],
    ['Другой груз', 'Площадка отправляет следующий по списку предмет, накопитель с другой стороны.'],
    ['Усиленный вариант', 'Две площадки либо накопитель плотнее; больше экспорта на тот же вход.'],
  ],
};

const minimalLabels = [
  ['Компактная', 'Выпуск на восток; входы разделены по соседним сторонам фабрики.'],
  ['Выпуск вверх', 'Тот же рецепт и число блоков, выход смотрит на север.'],
  ['Зеркальная', 'Выход на запад — можно поставить линию вплотную к другой базе.'],
];
const campaignMinimalLabels = [
  ['Короткий выпуск', 'Пусковая площадка стоит прямо за выходным конвейером.'],
  ['Верхний выпуск', 'Та же производительность, другой край выхода — удобно обходить препятствия.'],
  ['Нижний выпуск', 'Зеркальная компоновка с теми же входными портами и скоростью.'],
];
// With drones there are no lanes to reshape, so the production variants differ in scale instead.
const droneProductionLabels = [
  ['Две фабрики', 'Фабрики стоят вплотную к ядру: выход идёт прямо в ядро, ингредиенты возят дроны.'],
  ['Одна фабрика', 'Минимум блоков и дронов: одна фабрика у ядра.'],
  ['Три фабрики', 'Больше выпуск на том же принципе: три фабрики вокруг ядра и по процессору на каждый ингредиент.'],
];

function labelsFor(settings, minimalProductionMode) {
  if (minimalProductionMode) return settings.campaignLink ? campaignMinimalLabels : minimalLabels;
  if (settings.direction === 'production' && settings.supplyMode === 'drones') return droneProductionLabels;
  return variantTexts[settings.direction] ?? variantTexts.mining;
}

export function generateLayoutVariants(input = {}) {
  const settings = normalizeSettings(input);
  const minimalProductionMode = settings.direction === 'production' && (settings.minimal || settings.campaignLink);
  const candidates = [0, 1, 2].map(variant => generateLayout({ ...settings, variant }));
  const labels = labelsFor(settings, minimalProductionMode);
  const seen = new Set();
  const entries = [];
  candidates.forEach((scheme, index) => {
    const key = signature(scheme);
    if (seen.has(key) && entries.length >= 1 && !minimalProductionMode) return; // identical candidates are not offered twice
    seen.add(key);
    const analysis = analyzeFlow(scheme);
    entries.push({
      scheme, label: labels[index][0], note: labels[index][1], index,
      analysis: { errors: analysis.errors, warnings: analysis.warnings, infos: analysis.infos, power: analysis.power },
      score: scoreScheme(scheme, analysis),
    });
  });
  const best = entries.reduce((winner, entry) => (entry.score > winner.score ? entry : winner), entries[0]);
  return entries.map(entry => ({ ...entry, recommended: entry === best && entries.length > 1 }));
}
