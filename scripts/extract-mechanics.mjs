#!/usr/bin/env node
/**
 * Extract the gameplay facts that the layout generator and flow checker need but
 * `block-facts.json` does not carry: Java class per block, rotatable blocks,
 * turret ammo, generator fuel/output, unit plans and item properties.
 *
 * Usage:
 *   node scripts/extract-mechanics.mjs /path/to/Mindustry-v160.2
 *
 * The runtime never reads Mindustry sources; it only imports the generated
 * `src/mechanics-data.json`. Re-run this script when the pinned game tag changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const upstream = process.argv[2];
if (!upstream) {
  console.error('Usage: node scripts/extract-mechanics.mjs /path/to/Mindustry-v160.2');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const content = resolve(upstream, 'core/src/mindustry/content');
const blocksSource = readFileSync(resolve(content, 'Blocks.java'), 'utf8');
const itemsSource = readFileSync(resolve(content, 'Items.java'), 'utf8');
const catalog = JSON.parse(readFileSync(resolve(root, 'src/catalog.json'), 'utf8'));
const facts = JSON.parse(readFileSync(resolve(root, 'src/block-facts.json'), 'utf8'));

const kebab = value => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

/** `name = new Class("id"){{ ... }};` assignments, matched by braces. */
function parseBlocks(source) {
  const result = {};
  const pattern = /^ {8}(\w+)\s*=\s*new\s+(\w+)\s*\(\s*"([^"]+)"\s*\)\s*\{\{/gm;
  let match;
  while ((match = pattern.exec(source))) {
    const start = match.index + match[0].length;
    let depth = 2;
    let index = start;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      index += 1;
    }
    result[match[3]] = { variable: match[1], cls: match[2], body: source.slice(start, index - 2) };
  }
  return result;
}

function number(text) {
  if (text == null) return null;
  const cleaned = String(text).replace(/\/\/.*$/, '').trim();
  // Small safe evaluator: products and quotients of float literals ("60f * 15", "2f / 60f").
  if (!/^[-+0-9.fF\s*/()]+$/.test(cleaned)) return null;
  const tokens = cleaned.replace(/[()]/g, ' ').match(/[-+]?[0-9.]+[fF]?|[*/]/g);
  if (!tokens) return null;
  let value = parseFloat(tokens[0]);
  for (let index = 1; index < tokens.length; index += 2) {
    const operand = parseFloat(tokens[index + 1]);
    if (Number.isNaN(operand)) return null;
    value = tokens[index] === '*' ? value * operand : value / operand;
  }
  return Number.isFinite(value) ? value : null;
}

function itemStacks(text) {
  const stacks = {};
  for (const [, id, amount] of text.matchAll(/Items\.(\w+)\s*,\s*([0-9.fF]+)/g)) stacks[kebab(id)] = number(amount);
  return stacks;
}

function liquidStacks(text) {
  const stacks = {};
  for (const [, id, amount] of text.matchAll(/Liquids\.(\w+)\s*,\s*([^,)]+(?:\([^)]*\))?[^,)]*)/g)) {
    const value = number(amount);
    if (value != null) stacks[kebab(id)] = round(value * 60);
  }
  return stacks;
}

const blocks = parseBlocks(blocksSource);
const catalogBlocks = catalog.filter(entry => entry.type === 'block');
const known = new Set(catalogBlocks.map(entry => entry.id));

// --- block classes and rotation --------------------------------------------------------
const rotatingClasses = new Set([
  'Conveyor', 'ArmoredConveyor', 'StackConveyor', 'Duct', 'DuctRouter', 'OverflowDuct', 'DuctBridge',
  'DirectionalUnloader', 'Conduit', 'ArmoredConduit', 'DirectionLiquidBridge', 'PowerDiode',
  'HeatProducer', 'HeatCrafter', 'HeatConductor', 'HeaterGenerator', 'BeamDrill', 'WallCrafter',
  'UnitFactory', 'Reconstructor', 'UnitAssembler', 'UnitAssemblerModule', 'PayloadConveyor', 'PayloadRouter',
  'PayloadLoader', 'PayloadUnloader', 'PayloadMassDriver', 'Constructor', 'Thruster',
]);
const classes = {};
const rotate = [];
for (const [id, block] of Object.entries(blocks)) {
  if (!known.has(id)) continue;
  classes[id] = block.cls;
  if (rotatingClasses.has(block.cls) || /\brotate\s*=\s*true/.test(block.body)) rotate.push(id);
}

// --- items -------------------------------------------------------------------------------
const items = {};
for (const match of itemsSource.matchAll(/(\w+)\s*=\s*new\s+Item\("([^"]+)"[^{]*\{\{([\s\S]*?)\n {8}\}\};/g)) {
  const id = match[2];
  const body = match[3];
  const read = name => number(new RegExp(`\\b${name}\\s*=\\s*([^;]+);`).exec(body)?.[1]) ?? 0;
  items[id] = {
    hardness: read('hardness'), flammability: read('flammability'), explosiveness: read('explosiveness'),
    radioactivity: read('radioactivity'), charge: read('charge'),
  };
}

// --- turrets -----------------------------------------------------------------------------
const turrets = {};
const turretClasses = new Set(['ItemTurret', 'LiquidTurret', 'PowerTurret', 'TractorBeamTurret', 'PointDefenseTurret', 'LaserTurret', 'ContinuousLiquidTurret', 'ContinuousTurret']);
for (const [id, block] of Object.entries(blocks)) {
  if (!turretClasses.has(block.cls) || !known.has(id)) continue;
  const body = block.body;
  const ammoSection = /ammo\(([\s\S]*?)\n\s{12}\);/.exec(body)?.[1] ?? '';
  const ammoItems = [...new Set([...ammoSection.matchAll(/\bItems\.(\w+)\s*,/g)].map(m => kebab(m[1])))];
  const ammoLiquids = [...new Set([...ammoSection.matchAll(/\bLiquids\.(\w+)\s*,/g)].map(m => kebab(m[1])))];
  const bool = name => {
    const value = new RegExp(`\\b${name}\\s*=\\s*(true|false)`).exec(body)?.[1];
    return value == null ? true : value === 'true';
  };
  const consumedLiquids = {};
  for (const [, liquid, amount] of body.matchAll(/consumeLiquid\(\s*Liquids\.(\w+)\s*,\s*([^)]*)\)/g)) {
    const value = number(amount);
    if (value != null) consumedLiquids[kebab(liquid)] = round(value * 60);
  }
  turrets[id] = {
    class: block.cls,
    ammo: block.cls === 'ItemTurret' ? ammoItems : [],
    liquidAmmo: ammoLiquids,
    // Liquids that must be supplied for the turret to fire (not optional coolant).
    needs: consumedLiquids,
    power: round((number(/consumePower\(([^)]*)\)/.exec(body)?.[1]) ?? 0) * 60),
    range: number(/\brange\s*=\s*([^;]+);/.exec(body)?.[1]),
    air: bool('targetAir'),
    ground: bool('targetGround'),
    coolant: /consumeCoolant\(/.test(body),
  };
}

// --- generators / reactors -----------------------------------------------------------------------
const generators = {};
const generatorClasses = new Set(['ConsumeGenerator', 'ThermalGenerator', 'SolarGenerator', 'NuclearReactor', 'ImpactReactor', 'VariableReactor', 'HeaterGenerator']);
for (const [id, block] of Object.entries(blocks)) {
  if (!generatorClasses.has(block.cls) || !known.has(id)) continue;
  const body = block.body;
  const production = number(/\bpowerProduction\s*=\s*([^;]+);/.exec(body)?.[1]);
  const duration = number(/\bitemDuration\s*=\s*([^;]+);/.exec(body)?.[1]);
  let fuel = null;
  if (/ConsumeItemFlammable/.test(body)) fuel = 'flammable';
  else if (/ConsumeItemRadioactive/.test(body)) fuel = 'radioactive';
  else {
    const single = [...body.matchAll(/consumeItem\(\s*Items\.(\w+)/g)].map(m => kebab(m[1]));
    if (single.length) fuel = single;
  }
  const liquidsNeeded = {};
  for (const [, liquid, amount] of body.matchAll(/consumeLiquid\(\s*Liquids\.(\w+)\s*,\s*([^)]*)\)/g)) {
    const value = number(amount);
    if (value != null) liquidsNeeded[kebab(liquid)] = round(value * 60);
  }
  for (const group of body.matchAll(/consumeLiquids\(\s*LiquidStack\.with\(([\s\S]*?)\)\s*\)\s*;/g)) {
    Object.assign(liquidsNeeded, liquidStacks(group[1]));
  }
  // NuclearReactor expresses coolant as an expression of constants; keep the fact explicit.
  if (block.cls === 'NuclearReactor') liquidsNeeded.cryofluid = round(0.005 / 0.125 * 60);
  generators[id] = {
    class: block.cls,
    power: production == null ? 0 : round(production * 60),
    itemDuration: duration,
    fuel,
    liquids: liquidsNeeded,
    startupPower: round((number(/consumePower\(([^)]*)\)/.exec(body)?.[1]) ?? 0) * 60),
  };
}

// --- unit production ------------------------------------------------------------------------------
const unitFactories = {};
const reconstructors = {};
const assemblers = {};
for (const [id, block] of Object.entries(blocks)) {
  if (!known.has(id)) continue;
  const body = block.body;
  if (block.cls === 'UnitFactory') {
    const plans = [];
    for (const match of body.matchAll(/new\s+UnitPlan\(\s*UnitTypes\.(\w+)\s*,\s*([^,]+?)\s*,\s*with\(([^)]*)\)\s*\)/g)) {
      plans.push({ unit: kebab(match[1]), time: number(match[2]), cost: itemStacks(match[3]) });
    }
    unitFactories[id] = { power: round((number(/consumePower\(([^)]*)\)/.exec(body)?.[1]) ?? 0) * 60), plans };
  }
  if (block.cls === 'Reconstructor') {
    const upgrades = [...body.matchAll(/new\s+UnitType\[\]\s*\{\s*UnitTypes\.(\w+)\s*,\s*UnitTypes\.(\w+)\s*\}/g)].map(m => [kebab(m[1]), kebab(m[2])]);
    const itemsMatch = /consumeItems\(\s*with\(([^)]*)\)\s*\)/.exec(body);
    reconstructors[id] = {
      power: round((number(/consumePower\(([^)]*)\)/.exec(body)?.[1]) ?? 0) * 60),
      time: number(/constructTime\s*=\s*([^;]+);/.exec(body)?.[1]),
      cost: itemsMatch ? itemStacks(itemsMatch[1]) : {},
      liquids: Object.fromEntries([...body.matchAll(/consumeLiquid\(\s*Liquids\.(\w+)\s*,\s*([^)]*)\)/g)].map(m => [kebab(m[1]), round((number(m[2]) ?? 0) * 60)])),
      upgrades,
    };
  }
  if (block.cls === 'UnitAssembler') {
    const plans = [];
    for (const match of body.matchAll(/new\s+AssemblerUnitPlan\(\s*UnitTypes\.(\w+)\s*,\s*([^,]+?)\s*,\s*PayloadStack\.list\(([^)]*)\)\s*\)/g)) {
      const parts = match[3].split(',').map(part => part.trim());
      const payload = [];
      for (let index = 0; index + 1 < parts.length; index += 2) {
        const ref = parts[index].replace(/^(UnitTypes|Blocks)\./, '');
        payload.push({ id: kebab(ref), kind: parts[index].startsWith('UnitTypes.') ? 'unit' : 'block', amount: number(parts[index + 1]) });
      }
      plans.push({ unit: kebab(match[1]), time: number(match[2]), payload });
    }
    assemblers[id] = {
      power: round((number(/consumePower\(([^)]*)\)/.exec(body)?.[1]) ?? 0) * 60),
      liquids: Object.fromEntries([...body.matchAll(/consumeLiquid\(\s*Liquids\.(\w+)\s*,\s*([^)]*)\)/g)].map(m => [kebab(m[1]), round((number(m[2]) ?? 0) * 60)])),
      plans,
    };
  }
}

// --- drills ---------------------------------------------------------------------------------------
const drills = {};
for (const [id, block] of Object.entries(blocks)) {
  if (!['Drill', 'BeamDrill', 'BurstDrill', 'WallCrafter'].includes(block.cls) || !known.has(id)) continue;
  const body = block.body;
  drills[id] = {
    class: block.cls,
    tier: number(/\btier\s*=\s*([^;]+);/.exec(body)?.[1]),
    drillTime: number(/\bdrillTime\s*=\s*([^;]+);/.exec(body)?.[1]),
    range: number(/\brange\s*=\s*([^;]+);/.exec(body)?.[1]),
    output: /\boutput\s*=\s*Items\.(\w+)/.exec(body)?.[1] ? kebab(/\boutput\s*=\s*Items\.(\w+)/.exec(body)[1]) : null,
    blocked: /\bblockedItem\s*=\s*Items\.(\w+)/.exec(body)?.[1] ? kebab(/\bblockedItem\s*=\s*Items\.(\w+)/.exec(body)[1]) : null,
  };
}

// --- optional (boost) consumers -------------------------------------------------------------------
// block-facts.json merges `consumeLiquid(...).boost()` with mandatory consumers; flows must not demand them.
const optionalLiquids = {};
const optionalItems = {};
for (const [id, block] of Object.entries(blocks)) {
  if (!known.has(id)) continue;
  const liquids = [...block.body.matchAll(/consumeLiquid\(\s*Liquids\.(\w+)\s*,[^;]*?\)\s*\.(?:boost|optional)\(/g)].map(m => kebab(m[1]));
  const solids = [...block.body.matchAll(/consumeItems?\(\s*(?:with\(\s*)?Items\.(\w+)[^;]*?\)\s*\.(?:boost|optional)\(/g)].map(m => kebab(m[1]));
  if (liquids.length) optionalLiquids[id] = [...new Set(liquids)];
  if (solids.length) optionalItems[id] = [...new Set(solids)];
}

const data = {
  gameVersion: /GAME_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(resolve(root, 'src/game-version.js'), 'utf8'))?.[1] ?? 'unknown',
  classes, rotate: rotate.sort(), items, optionalLiquids, optionalItems, turrets, generators, unitFactories, reconstructors, assemblers, drills,
};
// Make sure every block of interest has an entry in `facts` (sanity check for the script itself).
const missingFacts = Object.keys(classes).filter(id => !facts[id]);
if (missingFacts.length) console.warn('Blocks without block-facts entries:', missingFacts.join(', '));
writeFileSync(resolve(root, 'src/mechanics-data.json'), `${JSON.stringify(data, null, 1)}\n`);
console.log(`mechanics-data.json: ${Object.keys(classes).length} classes, ${rotate.length} rotating, ${Object.keys(turrets).length} turrets, ${Object.keys(generators).length} generators`);
