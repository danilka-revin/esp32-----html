import test from 'node:test';
import assert from 'node:assert/strict';
import { blockById, campaignBlockById, getProductsForDirection, getProductionMachine } from '../src/catalog.js';
import { analyzeFlow, describeBlock, turretInfo } from '../src/flow.js';
import { blockRect, canvasPresets, generateLayout, generateLayoutVariants, initialSettings, missingEssential, withManualEdit } from '../src/generator.js';
import { analyzeMechanics } from '../src/mechanics.js';
import { drillRate } from '../src/gen/profile.js';
import { distanceToRect, footprint, rectCenter, rectsOverlap } from '../src/geometry.js';
import data from '../src/mechanics-data.json' with { type: 'json' };
import facts from '../src/block-facts.json' with { type: 'json' };

const directions = ['mining', 'production', 'defense', 'power', 'logistics', 'units', 'logic', 'campaign'];
const planets = ['serpulo', 'erekir'];
const stages = ['early', 'mid', 'late'];

function assertSound(scheme, label) {
  assert.deepEqual(scheme.problems, [], `${label}: ${scheme.problems.join('; ')}`);
  assert.ok(scheme.tiles.some(tile => tile.id.startsWith('core-')), `${label}: no core`);
  scheme.tiles.forEach((tile, index) => {
    const rect = blockRect(tile);
    assert.ok(rect.startX >= 0 && rect.startY >= 0 && rect.endX < scheme.width && rect.endY < scheme.height, `${label}: ${tile.id} outside the grid`);
    assert.ok(campaignBlockById.has(tile.id), `${label}: ${tile.id} is not a campaign block`);
    const block = blockById.get(tile.id);
    assert.ok(block.planet === 'both' || block.planet === scheme.settings.planet, `${label}: ${tile.id} does not exist on ${scheme.settings.planet}`);
    for (let other = index + 1; other < scheme.tiles.length; other += 1) {
      assert.equal(rectsOverlap(rect, blockRect(scheme.tiles[other])), false, `${label}: ${tile.id} overlaps ${scheme.tiles[other].id}`);
    }
  });
  const flow = analyzeFlow(scheme);
  assert.equal(flow.errors, 0, `${label}: ${flow.issues.filter(issue => issue.level === 'error').map(issue => issue.text).join(' | ')}`);
  return flow;
}

test('every generated blueprint is physically sound: no overlaps, valid blocks, working belts, power and liquids', () => {
  let checked = 0;
  for (const direction of directions) {
    for (const planet of planets) {
      for (const stage of stages) {
        for (const goal of getProductsForDirection(direction, planet, stage)) {
          for (const footprintId of Object.keys(canvasPresets)) {
            for (const variant of [0, 1, 2]) {
              const scheme = generateLayout({ ...initialSettings, minimal: false, direction, planet, stage, goal: goal.id, footprint: footprintId, variant, supplyMode: 'core' });
              assertSound(scheme, `${direction}/${planet}/${stage}/${goal.id}/${footprintId}/v${variant}`);
              checked += 1;
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 1000, `swept ${checked} layouts`);
});

test('a switched-off power plant leaves explicit power inlets instead of dangling consumers', () => {
  for (const [direction, goal, planet] of [['mining', 'thorium', 'serpulo'], ['production', 'silicon', 'serpulo'], ['units', 'ground', 'serpulo'], ['mining', 'beryllium', 'erekir']]) {
    const scheme = generateLayout({ ...initialSettings, minimal: false, direction, goal, planet, stage: 'late', includePower: false });
    const flow = analyzeFlow(scheme);
    assert.equal(flow.errors, 0, `${direction}/${goal}: ${flow.issues.map(issue => issue.text).join(' | ')}`);
    const powered = scheme.tiles.some(tile => describeBlock(tile.id).powerUse > 0);
    if (powered) assert.ok((scheme.inlets ?? []).some(inlet => inlet.kind === 'power'), `${direction}/${goal}: a node must mark where outside power connects`);
  }
});

test('the three candidates of a direction are different blueprints and one is recommended', () => {
  for (const direction of directions) {
    for (const planet of planets) {
      const goal = getProductsForDirection(direction, planet, 'mid')[0];
      if (!goal) continue;
      const candidates = generateLayoutVariants({ ...initialSettings, minimal: false, direction, planet, goal: goal.id, stage: 'mid' });
      assert.equal(candidates.length, 3, `${direction}/${planet}`);
      const signatures = new Set(candidates.map(({ scheme }) => scheme.tiles.map(tile => `${tile.id}:${tile.x}:${tile.y}:${tile.rotation}`).join('|')));
      assert.equal(signatures.size, 3, `${direction}/${planet}: candidates must differ`);
      assert.equal(candidates.filter(candidate => candidate.recommended).length, 1);
      for (const candidate of candidates) {
        assert.equal(candidate.analysis.errors, 0, `${direction}/${planet}/${candidate.label}`);
        assert.ok(Number.isFinite(candidate.score));
      }
    }
  }
});

test('an unsupported direction keeps a valid core-only blueprint with an explanation', () => {
  const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'logic', planet: 'erekir' });
  assert.equal(scheme.tiles.length, 1);
  assert.ok(scheme.tiles[0].id.startsWith('core-'));
  assert.ok(scheme.problems.length);
  assert.equal(getProductsForDirection('logic', 'erekir').length, 0);
});

test('goals match the planet: Serpulo ores on Serpulo, beryllium and tungsten on Erekir', () => {
  const ids = (direction, planet) => getProductsForDirection(direction, planet, 'mid').map(goal => goal.id);
  assert.deepEqual(ids('mining', 'serpulo'), ['copper', 'lead', 'sand', 'coal', 'scrap', 'titanium', 'thorium']);
  assert.deepEqual(ids('mining', 'erekir'), ['sand', 'thorium', 'beryllium', 'graphite', 'tungsten']);
  assert.ok(!ids('power', 'erekir').includes('solar'), 'Erekir has no solar panel');
  assert.ok(!ids('logistics', 'erekir').includes('driver'));
  assert.ok(ids('units', 'erekir').includes('mech'));
});

// ---------------------------------------------------------------------------------------------------------------------
// Mining
// ---------------------------------------------------------------------------------------------------------------------

test('mining picks a drill that can really mine the ore and reports the rate from the game formula', () => {
  const copper = generateLayout({ ...initialSettings, minimal: false, direction: 'mining', goal: 'copper', stage: 'mid' });
  assert.ok(copper.tiles.some(tile => tile.id === 'pneumatic-drill'), 'mid stage: the strongest drill that needs no power plant');
  assert.equal(copper.tiles.some(tile => describeBlock(tile.id).kind === 'generator'), false, 'no power plant for unpowered drills');
  const drills = copper.tiles.filter(tile => tile.id === 'pneumatic-drill').length;
  // 60 / (400 + 50 * hardness 1) * 4 ore tiles = 0.533 items/s per pneumatic drill.
  assert.ok(Math.abs(drillRate('pneumatic-drill', 'copper') - 60 / 450 * 4) < 1e-9);
  assert.ok(copper.notes.some(note => note.includes(`${drills} ×`) && note.includes((drills * 60 / 450 * 4).toFixed(2))));

  const thorium = generateLayout({ ...initialSettings, minimal: false, direction: 'mining', goal: 'thorium', stage: 'late' });
  const drill = thorium.tiles.find(tile => ['laser-drill', 'blast-drill'].includes(tile.id));
  assert.ok(drill, 'thorium needs a tier 4+ drill');
  assert.ok(thorium.tiles.some(tile => describeBlock(tile.id).kind === 'generator'), 'powered drills come with a plant');

  const tungsten = generateLayout({ ...initialSettings, minimal: false, direction: 'mining', goal: 'tungsten', planet: 'erekir', stage: 'mid' });
  assert.ok(tungsten.tiles.some(tile => tile.id === 'large-plasma-bore'), 'tungsten (hardness 5) needs the large plasma bore');
  assert.ok(tungsten.inlets.some(inlet => inlet.kind === 'liquid' && inlet.id === 'hydrogen'), 'its hydrogen supply is a declared inlet');
});

test('every drill of an Erekir bore field faces away from the collector, wall drills point at the ore', () => {
  const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'mining', goal: 'beryllium', planet: 'erekir', stage: 'mid', variant: 0 });
  const trunkY = scheme.tiles.find(tile => tile.id === 'duct')?.y;
  for (const tile of scheme.tiles.filter(candidate => candidate.id === 'plasma-bore')) {
    assert.equal(tile.rotation, tile.y > trunkY ? 1 : 3, 'bores face outwards');
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Defense
// ---------------------------------------------------------------------------------------------------------------------

test('all turrets of a defense line accept the one ammo item the supply delivers', () => {
  for (const planet of planets) {
    for (const stage of stages) {
      for (const goal of ['frontline', 'anti-air', 'heavy']) {
        const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'defense', goal, planet, stage });
        const unloader = scheme.tiles.find(tile => ['unloader', 'duct-unloader'].includes(tile.id));
        assert.ok(unloader?.config?.id, `${planet}/${stage}/${goal}: ammo filter`);
        const turrets = scheme.tiles.filter(tile => data.turrets[tile.id]?.class === 'ItemTurret');
        assert.ok(turrets.length >= 2, `${planet}/${stage}/${goal}: several turrets`);
        for (const turret of turrets) assert.ok(turretInfo(turret.id).ammo.includes(unloader.config.id), `${turret.id} accepts ${unloader.config.id}`);
      }
    }
  }
});

test('drone docks never take the room of the turrets: compact canvases keep their line and the Erekir cargo loader is powered', () => {
  for (const planet of planets) {
    for (const stage of stages) {
      for (const goal of ['frontline', 'anti-air', 'heavy']) {
        for (const supplyMode of ['drones', 'hybrid']) {
          for (const variant of [0, 1, 2]) {
            const label = `${planet}/${stage}/${goal}/${supplyMode}/v${variant}`;
            const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'defense', planet, stage, goal, footprint: 'compact', supplyMode, variant });
            const flow = assertSound(scheme, label);
            const turrets = scheme.tiles.filter(tile => describeBlock(tile.id).turret);
            assert.ok(turrets.length >= 2, `${label}: only ${turrets.length} turrets`);
            if (planet === 'erekir' && supplyMode === 'drones') {
              assert.ok(scheme.tiles.some(tile => tile.id === 'unit-cargo-loader'), `${label}: cargo loader`);
              assert.ok(flow.power.generation >= flow.power.demand, `${label}: the loader needs ${flow.power.demand} but the plant gives ${flow.power.generation}`);
            }
          }
        }
      }
    }
  }
});

test('an empty result is reported instead of shipping a bare core', () => {
  const bare = [{ id: 'core-shard', x: 5, y: 5, rotation: 0, config: null }];
  for (const direction of directions) assert.ok(missingEssential(direction, bare), `${direction} must complain about a bare core`);
  for (const direction of directions) {
    const scheme = generateLayout({ ...initialSettings, minimal: false, direction });
    assert.equal(missingEssential(direction, scheme.tiles), null, `${direction}: a normal blueprint has its essential blocks`);
  }
});

test('editing a blueprint by hand drops the generator failure list, but renaming or reselecting keeps it', () => {
  const failed = generateLayout({ ...initialSettings, minimal: false, direction: 'logic', planet: 'erekir' });
  assert.ok(failed.problems.length, 'the unsupported direction reports a problem');
  assert.equal(withManualEdit(failed, { ...failed, name: 'renamed' }).problems.length, failed.problems.length, 'same tiles: the problem still stands');
  const edited = withManualEdit(failed, { ...failed, tiles: [...failed.tiles, { id: 'conveyor', x: 0, y: 0, rotation: 0, config: null }] });
  assert.deepEqual(edited.problems, []);
  assert.equal(edited.tiles.length, failed.tiles.length + 1);
  const fine = generateLayout({ ...initialSettings, minimal: false, direction: 'defense' });
  const next = { ...fine, tiles: [] };
  assert.equal(withManualEdit(fine, next), next, 'a scheme without problems is passed through untouched');
});

test('anti-air defense builds anti-air turrets and the stage decides how heavy the line is', () => {
  const air = generateLayout({ ...initialSettings, minimal: false, direction: 'defense', goal: 'anti-air', stage: 'mid' });
  assert.ok(air.tiles.filter(tile => data.turrets[tile.id]).every(tile => data.turrets[tile.id].air));
  const early = generateLayout({ ...initialSettings, minimal: false, direction: 'defense', goal: 'frontline', stage: 'early' });
  const late = generateLayout({ ...initialSettings, minimal: false, direction: 'defense', goal: 'frontline', stage: 'late' });
  assert.ok(early.tiles.some(tile => tile.id === 'duo') && !early.tiles.some(tile => tile.id === 'ripple'));
  assert.ok(late.tiles.some(tile => tile.id === 'ripple'));
  assert.equal(early.tiles.find(tile => tile.id === 'unloader').config.id, 'copper', 'the cheapest ammo at the starter stage');
  assert.equal(late.tiles.find(tile => tile.id === 'unloader').config.id, 'graphite');
});

test('a campaign import chooses turrets that accept the imported item and feeds them from the landing pad', () => {
  const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'defense', campaignLink: true, transportItem: 'thorium', stage: 'mid' });
  const pad = scheme.tiles.find(tile => tile.id === 'landing-pad');
  assert.deepEqual(pad.config, { type: 'content', contentType: 'item', id: 'thorium' });
  const turrets = scheme.tiles.filter(tile => data.turrets[tile.id]?.class === 'ItemTurret');
  assert.ok(turrets.length);
  for (const turret of turrets) assert.ok(turretInfo(turret.id).ammo.includes('thorium'));
  assert.ok(scheme.inlets.some(inlet => inlet.kind === 'liquid' && inlet.id === 'water'), 'landing needs water');
});

// ---------------------------------------------------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------------------------------------------------

test('ring production: each unloader touches the core and the machine it feeds, and the machine touches the core', () => {
  const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'production', goal: 'silicon', stage: 'mid', variant: 0 });
  const core = footprint(scheme.tiles.find(tile => tile.id.startsWith('core-')));
  const touches = (a, b) => {
    const gapX = Math.max(a.startX - b.endX, b.startX - a.endX);
    const gapY = Math.max(a.startY - b.endY, b.startY - a.endY);
    return (gapX === 1 && gapY <= 0) || (gapY === 1 && gapX <= 0);
  };
  const machines = scheme.tiles.filter(tile => tile.id === 'silicon-smelter');
  assert.ok(machines.length >= 2);
  for (const machine of machines) {
    assert.ok(touches(footprint(machine), core), 'output goes straight into the core');
    const needed = new Set(Object.keys(facts['silicon-smelter'].inputs));
    const fed = scheme.tiles.filter(tile => tile.id === 'unloader' && touches(footprint(tile), footprint(machine)) && touches(footprint(tile), core)).map(tile => tile.config.id);
    assert.deepEqual(new Set(fed), needed, 'one unloader per ingredient');
  }
});

test('production always offers real alternatives; with drones the variants differ in the number of factories', () => {
  for (const planet of planets) {
    for (const supplyMode of ['core', 'local', 'drones', 'hybrid']) {
      const goal = planet === 'serpulo' ? 'silicon' : getProductsForDirection('production', planet, 'mid')[0].id;
      const candidates = generateLayoutVariants({ ...initialSettings, minimal: false, direction: 'production', planet, goal, stage: 'mid', supplyMode });
      assert.ok(candidates.length >= 2, `${planet}/${supplyMode}: only ${candidates.length} candidate(s)`);
      if (supplyMode !== 'drones') continue;
      assert.equal(candidates.length, 3, `${planet}/drones`);
      const crafters = candidates.map(({ scheme }) => scheme.tiles.filter(tile => describeBlock(tile.id).kind === 'crafter').length);
      assert.equal(new Set(crafters).size, 3, `${planet}/drones: factory counts ${crafters}`);
      assert.deepEqual(candidates.map(candidate => candidate.label), ['Две фабрики', 'Одна фабрика', 'Три фабрики']);
      if (planet === 'serpulo') assert.deepEqual(crafters, [2, 1, 3]);
      for (const candidate of candidates) assert.equal(candidate.analysis.errors, 0, `${planet}/${candidate.label}`);
    }
  }
});

test('multi-ingredient recipes get one dedicated lane per ingredient, crossing lanes with junctions', () => {
  const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'production', goal: 'surge-alloy', stage: 'late', variant: 1 });
  const unloaders = scheme.tiles.filter(tile => tile.id === 'unloader').map(tile => tile.config.id);
  const smelters = scheme.tiles.filter(tile => tile.id === 'surge-smelter').length;
  assert.equal(unloaders.length, 4 * smelters, 'copper, lead, titanium and silicon for each smelter');
  assert.ok(scheme.tiles.some(tile => tile.id === 'junction'), 'lanes cross without mixing');
});

test('Erekir production never unloads the core: a buffer container with a labelled inlet feeds the machine', () => {
  const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'production', goal: 'silicon', planet: 'erekir', stage: 'mid' });
  assert.ok(scheme.tiles.some(tile => tile.id.startsWith('reinforced-')));
  assert.ok(scheme.inlets.some(inlet => inlet.kind === 'item'));
  assert.equal(scheme.tiles.some(tile => tile.id === 'unloader'), false);
  const core = footprint(scheme.tiles.find(tile => tile.id.startsWith('core-')));
  for (const unloader of scheme.tiles.filter(tile => tile.id === 'duct-unloader')) {
    const back = { x: unloader.x - (unloader.rotation === 0 ? 1 : unloader.rotation === 2 ? -1 : 0), y: unloader.y - (unloader.rotation === 1 ? 1 : unloader.rotation === 3 ? -1 : 0) };
    assert.equal(back.x >= core.startX && back.x <= core.endX && back.y >= core.startY && back.y <= core.endY, false, 'not backed by the core');
  }
});

test('recipes that need heat or liquids get heaters and water supplies next to the machine', () => {
  const erekir = generateLayout({ ...initialSettings, minimal: false, direction: 'production', goal: 'carbide', planet: 'erekir', stage: 'late' });
  const crucible = erekir.tiles.find(tile => tile.id === 'carbide-crucible');
  assert.ok(erekir.tiles.some(tile => tile.id === 'electric-heater'));
  for (const heater of erekir.tiles.filter(tile => tile.id === 'electric-heater')) {
    const rect = footprint(heater);
    const target = footprint(crucible);
    const adjacent = (rect.endX + 1 === target.startX || rect.startX - 1 === target.endX || rect.endY + 1 === target.startY || rect.startY - 1 === target.endY);
    if (adjacent) {
      const center = rectCenter(rect);
      const front = [[1, 0], [0, 1], [-1, 0], [0, -1]][heater.rotation];
      const probe = { x: Math.round(center.x + front[0] * (rect.size / 2 + 0.5)), y: Math.round(center.y + front[1] * (rect.size / 2 + 0.5)) };
      assert.ok(probe.x >= target.startX - 1 && probe.x <= target.endX + 1 && probe.y >= target.startY - 1 && probe.y <= target.endY + 1, 'a heater points at its machine');
    }
  }
  const press = generateLayout({ ...initialSettings, minimal: false, direction: 'production', goal: 'plastanium', stage: 'mid', includePower: true });
  assert.ok(press.tiles.some(tile => tile.id === 'plastanium-compressor'));
  assert.ok(press.inlets.some(inlet => inlet.kind === 'liquid' && inlet.id === 'oil'), 'oil arrives through a labelled pipe');
});

// ---------------------------------------------------------------------------------------------------------------------
// Units, power, logic, campaign
// ---------------------------------------------------------------------------------------------------------------------

test('unit chains: blocks touch along the build direction, factories carry a plan and every consumer is fed', () => {
  const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'units', goal: 'ground', stage: 'late', variant: 0 });
  const chain = scheme.tiles.filter(tile => /factory|reconstructor/.test(tile.id)).sort((a, b) => b.x - a.x);
  assert.deepEqual(chain.map(tile => tile.id), ['ground-factory', 'additive-reconstructor', 'multiplicative-reconstructor']);
  assert.ok(chain.every(tile => tile.rotation === 2), 'all blocks face away from the core');
  assert.equal(chain[0].config, 0, 'plan 0 = dagger');
  for (let index = 0; index < chain.length - 1; index += 1) {
    assert.equal(footprint(chain[index]).startX - 1, footprint(chain[index + 1]).endX, 'payload moves from block to block');
  }
  const flow = analyzeFlow(scheme);
  assert.equal(flow.errors, 0);
  const spaced = generateLayout({ ...initialSettings, minimal: false, direction: 'units', goal: 'ground', stage: 'late', variant: 2 });
  assert.ok(spaced.tiles.some(tile => tile.id === 'payload-conveyor'));
  assert.equal(blockById.get('payload-conveyor').size, 3, 'payload conveyors are 3x3 blocks');
});

test('power nodes carry explicit links that are inside their laser range', () => {
  const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'mining', goal: 'thorium', stage: 'late', variant: 1 });
  const nodes = scheme.tiles.filter(tile => tile.id === 'power-node' && tile.config?.type === 'point2[]');
  assert.ok(nodes.length);
  for (const node of nodes) {
    const center = rectCenter(footprint(node));
    for (const point of node.config.points) {
      const target = scheme.tiles.find(tile => { const rect = footprint(tile); const x = node.x + point.x; const y = node.y + point.y; return x >= rect.startX && x <= rect.endX && y >= rect.startY && y <= rect.endY; });
      assert.ok(target, 'a link points at a building');
      assert.ok(distanceToRect(center.x, center.y, footprint(target)) <= describeBlock('power-node').laserRange, 'inside the 6-tile laser range');
    }
    assert.ok(node.config.points.length <= describeBlock('power-node').maxNodes);
  }
});

test('power plants produce what their notes claim and fuel-free ones need no lane', () => {
  const solar = generateLayout({ ...initialSettings, minimal: false, direction: 'power', goal: 'solar', stage: 'mid' });
  const flow = analyzeFlow(solar);
  assert.ok(flow.power.generation > 100);
  assert.equal(solar.tiles.some(tile => ['conveyor', 'unloader'].includes(tile.id)), false);
  const steam = generateLayout({ ...initialSettings, minimal: false, direction: 'power', goal: 'steam', stage: 'mid' });
  assert.ok(steam.tiles.filter(tile => tile.id === 'water-extractor').length >= 2, 'each steam generator gets water by adjacency');
  assert.ok(steam.tiles.some(tile => tile.id === 'unloader' && tile.config.id === 'coal'));
  const reactor = generateLayout({ ...initialSettings, minimal: false, direction: 'power', goal: 'reactor', stage: 'late' });
  assert.ok(reactor.tiles.some(tile => tile.id === 'cryofluid-mixer'), 'coolant is made next to the reactor');
  assert.deepEqual(reactor.tiles.filter(tile => tile.id === 'unloader').map(tile => tile.config.id).sort(), ['thorium', 'titanium']);
});

test('logic blueprints carry runnable MLOG with links in the order the code expects', () => {
  for (const goal of ['processor', 'display', 'switch']) {
    const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'logic', goal });
    const processor = scheme.tiles.find(tile => ['micro-processor', 'logic-processor'].includes(tile.id));
    assert.equal(processor.config.type, 'logic');
    const lines = processor.config.code.split('\n');
    const links = processor.config.links;
    const indexes = [...processor.config.code.matchAll(/getlink \w+ (\d+)/g)].map(match => Number(match[1]));
    assert.ok(Math.max(...indexes) < links.length, `${goal}: every getlink index has a link`);
    for (const line of lines) assert.ok(/^(getlink|sensor|write|read|op|print|printflush|draw|drawflush|control|end|jump)\b/.test(line), `${goal}: valid MLOG instruction «${line}»`);
    const range = processor.id === 'micro-processor' ? 10 : 22;
    for (const link of links) {
      const target = scheme.tiles.find(tile => tile.x === processor.x + link.x && tile.y === processor.y + link.y);
      assert.ok(target, `${goal}: link ${link.name} points at a building`);
      assert.ok(link.name.startsWith(target.id.split('-').at(-1)) || link.name.startsWith(target.id.split('-').at(-2) ?? '?'), `${goal}: link name ${link.name} follows Mindustry naming`);
      assert.ok(Math.hypot(link.x, link.y) <= range + 3, `${goal}: link within processor range`);
    }
  }
  const first = generateLayout({ ...initialSettings, minimal: false, direction: 'logic', goal: 'processor' });
  const processor = first.tiles.find(tile => tile.id === 'micro-processor');
  assert.equal(first.tiles.find(tile => tile.x === processor.x + processor.config.links[0].x && tile.y === processor.y + processor.config.links[0].y).id.startsWith('core-'), true, 'link 0 is the core');
});

test('campaign export feeds one item from the core into an oil-fed launch pad and the accelerator gets its ingredients', () => {
  const launch = generateLayout({ ...initialSettings, minimal: false, direction: 'campaign', goal: 'launch', stage: 'late', transportItem: 'lead' });
  assert.ok(launch.tiles.some(tile => tile.id === 'advanced-launch-pad'));
  assert.ok(launch.inlets.some(inlet => inlet.kind === 'liquid' && inlet.id === 'oil'));
  assert.equal(launch.tiles.find(tile => tile.id === 'unloader').config.id, 'lead');
  const accelerator = generateLayout({ ...initialSettings, minimal: false, direction: 'campaign', goal: 'accelerator', stage: 'late' });
  assert.deepEqual(accelerator.tiles.filter(tile => tile.id === 'unloader').map(tile => tile.config.id).sort(), ['copper', 'lead', 'silicon', 'thorium']);
  assert.ok(accelerator.tiles.some(tile => /battery/.test(tile.id)));
});

// ---------------------------------------------------------------------------------------------------------------------
// Data and mechanics
// ---------------------------------------------------------------------------------------------------------------------

test('game facts extracted from Mindustry v160.2 are internally consistent', () => {
  for (const [id, turret] of Object.entries(data.turrets)) {
    assert.ok(blockById.has(id), id);
    for (const item of turret.ammo) assert.ok(data.items[item], `${id} ammo ${item}`);
  }
  for (const [id, factory] of Object.entries(data.unitFactories)) assert.ok(blockById.has(id) && factory.plans.length, id);
  for (const id of ['conveyor', 'duct', 'plasma-bore', 'ground-factory', 'additive-reconstructor', 'duct-unloader', 'payload-conveyor']) assert.ok(data.rotate.includes(id), `${id} rotates`);
  for (const id of ['unloader', 'router', 'core-shard', 'silicon-smelter']) assert.equal(data.rotate.includes(id), false, `${id} does not rotate`);
  for (const block of campaignBlockById.values()) assert.ok(data.classes[block.id], `${block.id} has a Java class`);
  assert.equal(data.generators['combustion-generator'].power, 60);
  assert.equal(data.generators['thorium-reactor'].power, 900);
  assert.equal(data.unitFactories['ground-factory'].plans[0].unit, 'dagger');
  assert.equal(data.reconstructors['additive-reconstructor'].upgrades.find(([from]) => from === 'dagger')[1], 'mace');
});

test('catalog planets follow the tech trees: menders and projectors exist on Serpulo', () => {
  for (const id of ['mender', 'mend-projector', 'force-projector', 'shock-mine', 'overdrive-projector']) assert.equal(blockById.get(id).planet, 'serpulo', id);
  assert.equal(blockById.get('surge-conveyor').planet, 'erekir');
});

test('mechanics analysis reports flow results and stage mismatches from block costs', () => {
  const scheme = generateLayout({ ...initialSettings, minimal: false, direction: 'defense', goal: 'heavy', stage: 'early' });
  const report = analyzeMechanics(scheme);
  assert.equal(report.flow.errors, 0);
  assert.ok(report.warnings.some(warning => /дорого/.test(warning)), 'starter stage with heavy blocks is flagged by material cost');
  assert.ok(report.warnings.some(warning => /Статическая проверка/.test(warning)));
  assert.equal(getProductionMachine('serpulo', 'silicon', 'mid'), 'silicon-smelter');
});

test('generation is deterministic and fast enough for the editor', () => {
  const settings = { ...initialSettings, minimal: false, direction: 'production', goal: 'plastanium', stage: 'late', variant: 1 };
  const first = generateLayout(settings);
  const second = generateLayout(settings);
  assert.deepEqual(first.tiles, second.tiles);
  const started = performance.now();
  generateLayoutVariants({ ...settings, direction: 'units', goal: 'ground' });
  assert.ok(performance.now() - started < 3000, 'three candidates with checks in under three seconds');
});
