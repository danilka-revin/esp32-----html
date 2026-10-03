import test from 'node:test';
import assert from 'node:assert/strict';
import { buildableBlocks, campaignBlockById, gameCatalog, gameBlocks, liquids, materials, units } from '../src/catalog.js';
import { blockRect, canvasPresets, generateLayout, generateLayoutVariants, initialSettings, missingEssential } from '../src/generator.js';
import { GAME_VERSION } from '../src/game-version.js';
import { decodeSchematic, encodeSchematic } from '../src/schematic-io.js';
import { analyzeFlow } from '../src/flow.js';
import { buildLogicProgram, getLogicLinkInstructions, needsLogicProgram } from '../src/logic.js';
import { checkForUpdates, compareBuilds, sourceArchiveUrl } from '../src/update-checker.js';

const directions = ['mining', 'production', 'defense', 'power', 'logistics', 'units', 'logic', 'campaign'];
const planets = ['serpulo', 'erekir'];
const stages = ['early', 'mid', 'late'];

function overlaps(first, second) {
  const a = blockRect(first);
  const b = blockRect(second);
  return a.startX <= b.endX && a.endX >= b.startX && a.startY <= b.endY && a.endY >= b.startY;
}

test(`Mindustry ${GAME_VERSION} catalog covers the complete bundled object set`, () => {
  assert.equal(gameCatalog.length, 521);
  assert.equal(gameBlocks.length, 426);
  assert.equal(buildableBlocks.length, 226);
  assert.equal(gameBlocks.length - buildableBlocks.length, 200);
  assert.equal(materials.length, 22);
  assert.equal(liquids.length, 11);
  assert.equal(units.length, 62);
  assert.equal(buildableBlocks.find((block) => block.id === 'unit-cargo-loader')?.planet, 'erekir');
  assert.equal(buildableBlocks.find((block) => block.id === 'unit-cargo-unload-point')?.planet, 'erekir');
  assert.ok(campaignBlockById.has('advanced-launch-pad'));
  assert.ok(campaignBlockById.has('landing-pad'));
  assert.equal(gameBlocks.find((block) => block.id === 'heat-reactor')?.campaignBuildable, false, 'debug-only blocks stay out of the campaign palette');
});

test('all generator directions, planets, stages and footprints produce collision-free core layouts', () => {
  let checked = 0;
  for (const direction of directions) {
    for (const planet of planets) {
      for (const stage of stages) {
        for (const footprint of Object.keys(canvasPresets)) {
          for (const variant of [0, 1, 2]) {
            const scheme = generateLayout({ ...initialSettings, minimal: false, direction, planet, stage, footprint, variant, compactness: 25 + variant * 30 });
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

test('generator presents three valid Serpulo export choices with distinct orientations', () => {
  const candidates = generateLayoutVariants({ ...initialSettings, goal: 'silicon', campaignLink: true });
  assert.equal(candidates.length, 3);
  const signatures = new Set();
  candidates.forEach((candidate, index) => {
    const { scheme } = candidate;
    assert.equal(scheme.settings.variant, index);
    assert.ok(scheme.tiles.some((tile) => tile.id === 'advanced-launch-pad'));
    signatures.add(scheme.tiles.map((tile) => `${tile.id}:${tile.x}:${tile.y}:${tile.rotation}`).join('|'));
    for (let tileIndex = 0; tileIndex < scheme.tiles.length; tileIndex += 1) {
      const rect = blockRect(scheme.tiles[tileIndex]);
      assert.ok(rect.startX >= 0 && rect.startY >= 0 && rect.endX < scheme.width && rect.endY < scheme.height);
      assert.ok(campaignBlockById.has(scheme.tiles[tileIndex].id));
      for (let other = tileIndex + 1; other < scheme.tiles.length; other += 1) assert.equal(overlaps(scheme.tiles[tileIndex], scheme.tiles[other]), false, `${candidate.label} has overlapping blocks`);
    }
  });
  assert.equal(signatures.size, 3, 'each selectable blueprint has a distinct layout');
});

test('campaign defense imports a selected item through a configured landing pad', () => {
  const candidates = generateLayoutVariants({ ...initialSettings, minimal: false, direction: 'defense', campaignLink: true, transportItem: 'thorium' });
  assert.equal(candidates.length, 3);
  for (const { scheme } of candidates) {
    const pad = scheme.tiles.find((tile) => tile.id === 'landing-pad');
    assert.ok(pad);
    assert.deepEqual(pad.config, { type: 'content', contentType: 'item', id: 'thorium' });
    assert.equal(scheme.tiles.some((tile) => tile.id === 'unloader'), false, 'campaign import should not also unload from the core');
    for (let index = 0; index < scheme.tiles.length; index += 1) {
      for (let other = index + 1; other < scheme.tiles.length; other += 1) assert.equal(overlaps(scheme.tiles[index], scheme.tiles[other]), false);
    }
  }
});

test('factory, defense and unit layouts honor all supply modes with working flows and no overlaps', () => {
  const directionsWithSupply = ['production', 'defense', 'units'];
  const modes = ['core', 'local', 'drones', 'hybrid'];
  let checked = 0;
  for (const direction of directionsWithSupply) {
    for (const planet of planets) {
      for (const stage of stages) {
        for (const footprint of Object.keys(canvasPresets)) {
          for (const supplyMode of modes) {
            const settings = { ...initialSettings, minimal: false, direction, planet, stage, footprint, supplyMode, processorControl: supplyMode === 'core', variant: 1 };
            const scheme = generateLayout(settings);
            const label = `${direction}/${planet}/${stage}/${footprint}/${supplyMode}`;
            assert.ok(scheme.tiles.some((tile) => tile.id.startsWith('core-')), `${label} is missing a core`);
            assert.equal(scheme.settings.supplyMode, supplyMode);
            assert.deepEqual(scheme.problems, [], `${label}: ${scheme.problems.join('; ')}`);
            assert.equal(missingEssential(direction, scheme.tiles), null, `${label}: the blueprint lacks its turrets, machines or factories`);
            for (let index = 0; index < scheme.tiles.length; index += 1) {
              const rect = blockRect(scheme.tiles[index]);
              assert.ok(rect.startX >= 0 && rect.startY >= 0 && rect.endX < scheme.width && rect.endY < scheme.height, `${label}: block outside the grid`);
              for (let other = index + 1; other < scheme.tiles.length; other += 1) {
                assert.equal(overlaps(scheme.tiles[index], scheme.tiles[other]), false, `${label}: ${scheme.tiles[index].id} overlaps ${scheme.tiles[other].id}`);
              }
            }
            const flow = analyzeFlow(scheme);
            assert.equal(flow.errors, 0, `${label}: ${flow.issues.filter((issue) => issue.level === 'error').map((issue) => issue.text).join(' | ')}`);
            const unloaderId = planet === 'erekir' ? 'duct-unloader' : 'unloader';
            if (['core', 'hybrid'].includes(supplyMode)) {
              const unloaders = scheme.tiles.filter((tile) => tile.id === unloaderId);
              assert.ok(unloaders.length, `${label} must include a resource unloader`);
              for (const unloader of unloaders) assert.equal(unloader.config?.type, 'content', `${label}: every unloader needs an item filter`);
            }
            if (['drones', 'hybrid'].includes(supplyMode) && planet === 'erekir') {
              assert.equal(scheme.tiles.some((tile) => ['micro-processor', 'logic-processor'].includes(tile.id)), false, 'Erekir cargo drones do not use MLOG processors');
              if (supplyMode === 'drones') {
                assert.ok(scheme.tiles.some((tile) => tile.id === 'unit-cargo-loader'), `${label} must include an autonomous cargo loader`);
                const unloadPoints = scheme.tiles.filter((tile) => tile.id === 'unit-cargo-unload-point');
                assert.ok(unloadPoints.length, `${label} must include a cargo unload point`);
                for (const point of unloadPoints) assert.equal(point.config?.contentType, 'item');
              }
            } else if (['drones', 'hybrid'].includes(supplyMode)) {
              const processors = scheme.tiles.filter((tile) => ['micro-processor', 'logic-processor'].includes(tile.id));
              assert.ok(processors.length, `${label} must include a processor`);
              assert.ok(processors.some((tile) => tile.config?.type === 'logic' && /ubind/.test(tile.config.code) && tile.config.links.length > 0), `${label}: the drone program and its link are written into the processor`);
            }
            checked += 1;
          }
        }
      }
    }
  }
  assert.equal(checked, 216);
});

test('MLOG snippets configure reserve control and unit-based factory supply', () => {
  const coreSettings = { ...initialSettings, minimal: false, direction: 'production', supplyMode: 'core', processorControl: true, transportItem: 'copper', reserveThreshold: 90 };
  const coreProgram = buildLogicProgram(coreSettings);
  assert.match(coreProgram, /getlink core 0/);
  assert.match(coreProgram, /getlink factory 1/);
  assert.match(coreProgram, /sensor stock core @copper/);
  assert.match(coreProgram, /jump 6 lessThan stock 90/);
  assert.match(coreProgram, /control enabled factory 0/);
  assert.match(getLogicLinkInstructions(coreSettings), /ядро первым/);

  const droneSettings = { ...initialSettings, minimal: false, direction: 'production', supplyMode: 'drones', droneUnit: 'poly', transportItem: 'titanium', droneCapacity: 70 };
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

test('update archives point to the selected GitHub revision', () => {
  const sha = 'b'.repeat(40);
  assert.equal(sourceArchiveUrl(sha), `https://codeload.github.com/danilka-revin/esp32-----html/zip/${sha}`);
  assert.equal(sourceArchiveUrl(''), 'https://codeload.github.com/danilka-revin/esp32-----html/zip/main');
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
  const scheme = generateLayout({ ...initialSettings, minimal: false });
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
  const exportedUnloaders = scheme.tiles.filter((tile) => tile.id === 'unloader');
  const importedUnloaders = decoded.tiles.filter((tile) => tile.id === 'unloader');
  const smelters = scheme.tiles.filter((tile) => tile.id === 'silicon-smelter').length;
  assert.ok(smelters >= 1);
  assert.deepEqual(exportedUnloaders.map((tile) => tile.config?.id).sort(), [...Array(smelters).fill('coal'), ...Array(smelters).fill('sand')].sort(), 'every silicon smelter needs its own coal and sand unloader');
  assert.deepEqual(importedUnloaders.map((tile) => tile.config), exportedUnloaders.map((tile) => tile.config));
  assert.deepEqual(decoded.tiles.map((tile) => tile.config), scheme.tiles.map((tile) => tile.config), 'every configuration survives the file');
  assert.equal(decoded.settings.supplyMode, scheme.settings.supplyMode);
  assert.equal(decoded.settings.goal, scheme.settings.goal);
  assert.equal(decoded.settings.processorControl, scheme.settings.processorControl);
  assert.equal(decoded.settings.droneCapacity, scheme.settings.droneCapacity);

  const erekirScheme = generateLayout({ ...initialSettings, minimal: false, planet: 'erekir', direction: 'defense', supplyMode: 'hybrid', transportItem: 'beryllium' });
  const erekirDecoded = decodeSchematic(encodeSchematic(erekirScheme));
  assert.deepEqual(erekirDecoded.tiles.find((tile) => tile.id === 'duct-unloader')?.config, { type: 'content', contentType: 'item', id: 'beryllium' });
  assert.deepEqual(erekirDecoded.tiles.filter((tile) => tile.id === 'unit-cargo-unload-point').map((tile) => tile.config), erekirScheme.tiles.filter((tile) => tile.id === 'unit-cargo-unload-point').map((tile) => tile.config));
});

test('campaign export flag survives the Mindustry schematic round-trip', () => {
  const scheme = generateLayout({ ...initialSettings, campaignLink: true });
  const decoded = decodeSchematic(encodeSchematic(scheme));
  assert.ok(decoded.tiles.some((tile) => tile.id === 'advanced-launch-pad'));
  assert.equal(decoded.tags.campaignLink, 'true');
  assert.equal(decoded.settings.campaignLink, true);
});
