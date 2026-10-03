#!/usr/bin/env node
/**
 * Developer tool: render a generated layout as ASCII and print the flow-check verdict.
 *   node scripts/render-layout.mjs direction=mining planet=serpulo stage=mid goal=copper variant=1
 * Any `key=value` pair is passed to generateLayout() (booleans/numbers are parsed).
 */
import { generateLayout, initialSettings } from '../src/generator.js';
import { analyzeFlow } from '../src/flow.js';
import { footprint } from '../src/geometry.js';
import { blockById } from '../src/catalog.js';

const input = { minimal: false };
for (const arg of process.argv.slice(2)) {
  const [key, raw] = arg.split('=');
  input[key] = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
}
const scheme = generateLayout({ ...initialSettings, ...input });
const grid = Array.from({ length: scheme.height }, () => Array(scheme.width).fill('·'));
const arrows = ['>', '^', '<', 'v'];
const legend = new Map();
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const symbolFor = new Map();
const symbol = id => {
  if (/(^|-)conveyor$|^duct$/.test(id)) return null;
  if (!symbolFor.has(id)) symbolFor.set(id, letters[symbolFor.size % letters.length]);
  legend.set(symbolFor.get(id), id);
  return symbolFor.get(id);
};
for (const tile of scheme.tiles) {
  const rect = footprint(tile);
  const belt = /(^|-)conveyor$|^duct$|conduit$/.test(tile.id) && !/junction|bridge/.test(tile.id);
  for (let y = rect.startY; y <= rect.endY; y += 1) {
    for (let x = rect.startX; x <= rect.endX; x += 1) {
      let char;
      if (belt) char = arrows[tile.rotation];
      else if (tile.id === 'junction' || tile.id === 'reinforced-liquid-junction') char = '+';
      else if (tile.id === 'router' || tile.id === 'duct-router') char = 'R';
      else if (tile.id === 'unloader' || tile.id === 'duct-unloader') char = 'U';
      else if (tile.id === 'power-node' || tile.id === 'beam-node') char = 'n';
      else char = symbol(tile.id) ?? '?';
      grid[scheme.height - 1 - y][x] = char;
    }
  }
}
console.log(`${scheme.name} · ${scheme.width}×${scheme.height} · ${scheme.tiles.length} блоков`);
console.log(grid.map(row => row.join(' ')).join('\n'));
console.log([...legend].map(([char, id]) => `${char}=${blockById.get(id)?.name ?? id}`).join('  '));
for (const note of scheme.notes ?? []) console.log(`• ${note}`);
const result = analyzeFlow(scheme);
console.log(`\nПроверка: ошибок ${result.errors}, предупреждений ${result.warnings}, энергия ${Math.round(result.power.generation)}/${Math.round(result.power.demand)}`);
for (const issue of result.issues) console.log(` [${issue.level}] ${issue.text}`);
