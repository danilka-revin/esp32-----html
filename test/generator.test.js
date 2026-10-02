import test from 'node:test';
import assert from 'node:assert/strict';
import { buildableBlocks, gameCatalog, gameBlocks, liquids, materials, units } from '../src/catalog.js';
import { blockRect, canvasPresets, generateLayout, initialSettings } from '../src/generator.js';
import { decodeSchematic, encodeSchematic } from '../src/schematic-io.js';
import { buildLogicProgram, getLogicLinkInstructions, needsLogicProgram } from '../src/logic.js';
import { checkForUpdates, compareBuilds } from '../src/update-checker.js';

const directions = ['mining', 'production', 'defense', 'power', 'logistics', 'units', 'logic', 'campaign'];
const planets = ['serpulo', 'erekir'];
const stages = ['early', 'mid', 'late'];

function overlaps(first, second) {
  const a = blockRect(first);
  const b = blockRect(second);
  return a.startX <= b.endX && a.endX >= b.startX && a.startY <= b.endY && a.endY >= b.startY;
}

test('vanilla v146 catalog covers the complete bundled object set', () => {
  assert.equal(gameCatalog.length, 476);
  assert.equal(gameBlocks.length, 393);
  assert.equal(buildableBlocks.length, 255);
  assert.equal(gameBlocks.length - buildableBlocks.length, 138);
  assert.equal(materials.length, 22);
  assert.equal(liquids.length, 11);
  assert.equal(units.length, 50);
  assert.equal(buildableBlocks.find((block) => block.id === 'unit-cargo-loader')?.planet, 'erekir');
  assert.equal(buildableBlocks.find((block) => block.id === 'unit-cargo-unload-point')?.planet, 'erekir');
});

test('all generator directions, planets, stages and footprints produce collision-free core layouts', () => {
  let checked = 0;
  for (const direction of directions) {
    for (const planet of planets) {
      for (const stage of stages) {
        for (const footprint of Object.keys(canvasPresets)) {
          for (const variant of [0, 1, 2]) {
            const scheme = generateLayout({ ...initialSettings, direction, planet, stage, footprint, variant, compactness: 25 + variant * 30 });
            assert.ok(scheme.tiles.some((tile) => tile.id.startsWith('core-')), `${direction}/${planet}/${stage}/${footprint} is missing a core`);
            for (let index = 0; index < scheme.tiles.length; index += 1) {
              const rect = blockRect(scheme.tiles[index]);
              assert.ok(rect.startX >= 0 && rect.startY >= 0 && rect.endX < scheme.width && rect.endY < scheme.height, `${direction}/${planet}/${stage}/${footprint} has a block outside the grid`);
              for (let other = index + 1; other < scheme.tiles.length; other += 1) {
                assert.equal(overlaps(scheme.tiles[index], scheme.tiles[other]), false, `${scheme.tiles[index].id} overlaps ${scheme.tiles[other].id}`);
              }
            }
            checked += 1;
          }
        }
      }
    }
  }
  assert.equal(checked, 432);
});

test('factory, defense, unit and logistics layouts honor all supply modes without overlaps', () => {
  const directionsWithSupply = ['production', 'defense', 'units', 'logistics'];
  const modes = ['core', 'local', 'drones', 'hybrid'];
  let checked = 0;
  for (const direction of directionsWithSupply) {
    for (const planet of planets) {
      for (const stage of stages) {
        for (const footprint of Object.keys(canvasPresets)) {
          for (const supplyMode of modes) {
            const settings = { ...initialSettings, direction, planet, stage, footprint, supplyMode, processorControl: supplyMode === 'core', variant: 1 };
            const scheme = generateLayout(settings);
            assert.ok(scheme.tiles.some((tile) => tile.id.startsWith('core-')), `${direction}/${planet}/${stage}/${footprint}/${supplyMode} is missing a core`);
            assert.equal(scheme.settings.supplyMode, supplyMode);
            for (let index = 0; index < scheme.tiles.length; index += 1) {
              const rect = blockRect(scheme.tiles[index]);
              assert.ok(rect.startX >= 0 && rect.startY >= 0 && rect.endX < scheme.width && rect.endY < scheme.height);
              for (let other = index + 1; other < scheme.tiles.length; other += 1) {
                assert.equal(overlaps(scheme.tiles[index], scheme.tiles[other]), false, `${direction}/${planet}/${stage}/${footprint}/${supplyMode}: ${scheme.tiles[index].id} overlaps ${scheme.tiles[other].id}`);
              }
            }
            if (['drones', 'hybrid'].includes(supplyMode) && planet === 'erekir') {
              assert.ok(scheme.tiles.some((tile) => tile.id === 'unit-cargo-loader'), `${direction}/${planet}/${supplyMode} must include an autonomous cargo loader`);
              const unloadPoint = scheme.tiles.find((tile) => tile.id === 'unit-cargo-unload-point');
              assert.ok(unloadPoint, `${direction}/${planet}/${supplyMode} must include a cargo unload point`);
              assert.deepEqual(unloadPoint.config, { type: 'content', contentType: 'item', id: 'beryllium' });
              assert.equal(scheme.tiles.some((tile) => ['micro-processor', 'logic-processor'].includes(tile.id)), false, 'Erekir cargo drones do not use MLOG processors');
            } else if (['drones', 'hybrid'].includes(supplyMode)) {
              assert.ok(scheme.tiles.some((tile) => ['micro-processor', 'logic-processor'].includes(tile.id)), `${direction}/${planet}/${supplyMode} must include a processor`);
            }
            if (['core', 'hybrid'].includes(supplyMode)) {
              const unloader = scheme.tiles.find((tile) => tile.id === (planet === 'erekir' ? 'duct-unloader' : 'unloader'));
              assert.ok(unloader, `${direction}/${planet}/${supplyMode} must include a resource unloader`);
              assert.deepEqual(unloader.config, { type: 'content', contentType: 'item', id: planet === 'erekir' ? 'beryllium' : 'copper' });
            }
            checked += 1;
          }
        }
      }
    }
  }
  assert.equal(checked, 288);
});

test('MLOG snippets configure reserve control and unit-based factory supply', () => {
  const coreSettings = { ...initialSettings, direction: 'production', supplyMode: 'core', processorControl: true, transportItem: 'copper', reserveThreshold: 90 };
  const coreProgram = buildLogicProgram(coreSettings);
  assert.match(coreProgram, /getlink core 0/);
  assert.match(coreProgram, /getlink factory 1/);
  assert.match(coreProgram, /sensor stock core @copper/);
  assert.match(coreProgram, /jump 6 lessThan stock 90/);
  assert.match(coreProgram, /control enabled factory 0/);
  assert.match(getLogicLinkInstructions(coreSettings), /ядро первым/);

  const droneSettings = { ...initialSettings, direction: 'production', supplyMode: 'drones', droneUnit: 'poly', transportItem: 'titanium', droneCapacity: 70 };
  const droneProgram = buildLogicProgram(droneSettings);
  assert.match(droneProgram, /getlink factory 0/);
  assert.match(droneProgram, /ubind @poly/);
  assert.match(droneProgram, /ucontrol itemTake core @titanium 70/);
  assert.match(droneProgram, /ucontrol itemDrop factory 70/);
  assert.equal(needsLogicProgram(droneSettings), true);
  assert.match(getLogicLinkInstructions(droneSettings), /слот 0/);
  assert.equal(needsLogicProgram({ direction: 'mining', supplyMode: 'core', processorControl: false }), false);
  assert.equal(buildLogicProgram({ ...droneSettings, planet: 'erekir' }), '');
  assert.equal(needsLogicProgram({ ...droneSettings, planet: 'erekir' }), false);
});

test('update checker separates a deployed web build from source-only GitHub commits', async () => {
  const local = { version: '1.0.0', branch: 'main', commit: 'a'.repeat(40), buildId: 'build-a' };
  const currentManifest = { ...local };
  assert.equal(compareBuilds(local, currentManifest, { sha: local.commit }).status, 'current');
  assert.equal(compareBuilds(local, { ...local, commit: 'b'.repeat(40), buildId: 'build-b' }, { sha: 'b'.repeat(40) }).status, 'deployed-update');
  assert.equal(compareBuilds(local, currentManifest, { sha: 'c'.repeat(40) }).status, 'source-ahead');
  assert.equal(compareBuilds({ ...local, branch: 'arena/feature' }, currentManifest, { sha: 'c'.repeat(40) }).status, 'current');

  const result = await checkForUpdates({
    buildInfo: local,
    now: () => 1_700_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(options.cache, 'no-store');
      if (url.startsWith('/version.json')) return { ok: true, json: async () => currentManifest };
      return { ok: true, json: async () => ({ sha: local.commit, commit: { message: 'same build' } }) };
    },
  });
  assert.equal(result.status, 'current');
  assert.equal(result.githubReachable, true);
  assert.equal(result.manifestReachable, true);
});

test('MSCH export is a valid zlib-backed Mindustry schematic and round-trips', () => {
  const scheme = generateLayout(initialSettings);
  const bytes = encodeSchematic(scheme);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'msch');
  assert.equal(bytes[4], 1);
  assert.equal(bytes[5], 0x78, 'Mindustry .msch payload should use a zlib stream');
  const decoded = decodeSchematic(bytes);
  assert.equal(decoded.width, scheme.width);
  assert.equal(decoded.height, scheme.height);
  assert.equal(decoded.name, scheme.name);
  assert.equal(decoded.tiles.length, scheme.tiles.length);
  assert.deepEqual(decoded.tiles.map(({ id, x, y, rotation }) => ({ id, x, y, rotation })), scheme.tiles.map(({ id, x, y, rotation }) => ({ id, x, y, rotation })));
  const exportedUnloader = scheme.tiles.find((tile) => tile.id === 'unloader');
  const importedUnloader = decoded.tiles.find((tile) => tile.id === 'unloader');
  assert.deepEqual(exportedUnloader.config, { type: 'content', contentType: 'item', id: 'copper' });
  assert.deepEqual(importedUnloader.config, exportedUnloader.config);
  assert.equal(decoded.settings.supplyMode, scheme.settings.supplyMode);
  assert.equal(decoded.settings.goal, scheme.settings.goal);
  assert.equal(decoded.settings.processorControl, scheme.settings.processorControl);
  assert.equal(decoded.settings.droneCapacity, scheme.settings.droneCapacity);

  const erekirScheme = generateLayout({ ...initialSettings, planet: 'erekir', direction: 'production', supplyMode: 'hybrid', transportItem: 'beryllium' });
  const erekirDecoded = decodeSchematic(encodeSchematic(erekirScheme));
  assert.deepEqual(erekirDecoded.tiles.find((tile) => tile.id === 'duct-unloader')?.config, { type: 'content', contentType: 'item', id: 'beryllium' });
  assert.deepEqual(erekirDecoded.tiles.find((tile) => tile.id === 'unit-cargo-unload-point')?.config, { type: 'content', contentType: 'item', id: 'beryllium' });
});
