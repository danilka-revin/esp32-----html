import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gameCatalog, blockById } from '../src/catalog.js';
import { generateLayout, initialSettings, blockFits, blockRect } from '../src/generator.js';
import { analyzeMechanics, productionMachines, trimLayout } from '../src/mechanics.js';
import { encodeSchematic, decodeSchematic } from '../src/schematic-io.js';
import sprites from '../src/sprite-manifest.json' with { type: 'json' };

const beltCapacity = { conveyor: 4.2, 'titanium-conveyor': 11, duct: 15 };
const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function assertGeometry(scheme) {
  scheme.tiles.forEach(tile => assert.ok(blockFits(scheme.tiles, tile.id, tile.x, tile.y, scheme.width, scheme.height, tile), `${tile.id}: outside grid or overlap`));
}

test('every catalog entry has an offline PNG and recorded upstream provenance', () => {
  assert.equal(Object.keys(sprites).length, gameCatalog.length);
  for (const entry of gameCatalog) {
    const sprite = sprites[`${entry.type}:${entry.id}`];
    assert.ok(sprite);
    const file = new URL(`../public${sprite.file}`, import.meta.url);
    assert.ok(existsSync(file));
    assert.equal(readFileSync(file).subarray(1, 4).toString(), 'PNG');
    if (!sprite.invisible && !sprite.fallback) assert.ok(sprite.layers.length);
  }
  assert.deepEqual(Object.entries(sprites).filter(([,v]) => v.fallback).map(([k]) => k), ['block:shield-breaker']);
});

test('even footprints use Mindustry anchors, not a half-tile-shifted editor convention', () => {
  assert.deepEqual(blockRect({ id: 'silicon-smelter', x: 1, y: 1 }), { startX: 1, startY: 1, endX: 2, endY: 2, size: 2 });
  assert.deepEqual(blockRect({ id: 'surge-smelter', x: 2, y: 2 }), { startX: 1, startY: 1, endX: 3, endY: 3, size: 3 });
});

test('minimal recipes have separate directed input lanes, enough throughput and an outward output', () => {
  for (const [planet, recipes] of Object.entries(productionMachines)) {
    for (const [goal, machine] of Object.entries(recipes)) {
      for (const includePower of [false, true]) {
        const scheme = generateLayout({ ...initialSettings, planet, goal, includePower });
        assertGeometry(scheme);
        assert.equal(scheme.tiles.filter(t => t.id === machine).length, 1);
        assert.equal(scheme.tiles.some(t => /core-|reactor|processor|router/.test(t.id)), false);
        const analysis = analyzeMechanics(scheme);
        const recipe = analysis.requirements[0];
        const rect = blockRect(recipe.tile);
        recipe.inputs.forEach((input, i) => {
          const x = i < rect.size ? rect.startX - 1 : rect.startX + i - rect.size;
          const y = i < rect.size ? rect.startY + i : rect.startY - 1;
          const belt = scheme.tiles.find(t => t.x === x && t.y === y);
          assert.ok(belt, `${planet}/${goal}: missing ${input.id} lane`);
          assert.ok(beltCapacity[belt.id] >= input.rate, `${goal}/${input.id}: bottleneck`);
          const [dx, dy] = dirs[belt.rotation];
          assert.ok(x + dx >= rect.startX && x + dx <= rect.endX && y + dy >= rect.startY && y + dy <= rect.endY);
        });
        const output = scheme.tiles.find(t => t.x === rect.endX + 1 && t.y === rect.startY);
        assert.equal(output.rotation, 0);
        assert.ok(beltCapacity[output.id] >= recipe.output[0].rate);
        assert.ok(scheme.width * scheme.height <= 25);
        const imported = decodeSchematic(encodeSchematic(scheme));
        assert.deepEqual(imported.tiles, scheme.tiles);
        assert.equal(imported.settings.minimal, true);
        assert.equal(imported.settings.supplyMode, 'external');
        assertGeometry(imported);
        assert.equal(analyzeMechanics(imported).power, analysis.power);
      }
    }
  }
});

test('silicon recipe, power and building costs come from v146, not guesses', () => {
  const scheme = generateLayout(initialSettings);
  const data = analyzeMechanics(scheme);
  assert.equal(scheme.width, 4);
  assert.equal(scheme.height, 3);
  assert.equal(scheme.tiles.length, 5);
  assert.deepEqual(data.requirements[0].inputs, [{ id: 'coal', rate: 1.5 }, { id: 'sand', rate: 3 }]);
  assert.deepEqual(data.requirements[0].output, [{ id: 'silicon', rate: 1.5 }]);
  assert.equal(data.power, 30);
  assert.equal(data.costs.get('copper'), 34); // smelter 30 + 3 belts + node 1
  assert.equal(data.costs.get('lead'), 28);
  assert.equal(data.unknownCosts, 0);
});

test('phase sand uses a faster belt; Erekir heat and liquid requirements are explicit', () => {
  const phase = generateLayout({ goal: 'phase-fabric', planet: 'serpulo' });
  assert.ok(phase.tiles.some(t => t.id === 'titanium-conveyor'));
  const surge = analyzeMechanics(generateLayout({ goal: 'surge-alloy', planet: 'erekir' }));
  assert.equal(surge.requirements[0].heat, 10);
  assert.equal(surge.requirements[0].liquids.slag, 40);
  assert.ok(surge.warnings.some(w => w.includes('тепло')));
  assert.ok(surge.warnings.some(w => w.includes('жидкость')));
  assert.equal(productionMachines.erekir.graphite, undefined);
  assert.equal(productionMachines.erekir.plastanium, undefined);
});

test('trimming removes empty margins without changing topology or relative configurations', () => {
  const tile = { id: 'silicon-smelter', x: 10, y: 10, rotation: 2, config: null };
  const scheme = trimLayout({ width: 24, height: 18, tiles: [tile] });
  assert.deepEqual([scheme.width, scheme.height], [2, 2]);
  assert.deepEqual(scheme.tiles[0], { ...tile, x: 0, y: 0 });
  assert.equal(tile.x, 10);
  assertGeometry(scheme);
  assert.equal(blockById.get('silicon-smelter').size, 2);
});

test('editing an input immediately produces a mechanical warning', () => {
  const scheme = generateLayout(initialSettings);
  const changed = { ...scheme, tiles: scheme.tiles.map(t => t.id === 'conveyor' && t.x === 0 ? { ...t, rotation: 2 } : t) };
  assert.ok(analyzeMechanics(changed).warnings.some(w => w.includes('неверное направление')));
  assert.equal(analyzeMechanics(scheme).warnings.some(w => w.includes('неверное направление')), false);
});
