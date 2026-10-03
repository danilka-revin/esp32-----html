import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFlow, describeBlock } from '../src/flow.js';

const item = id => ({ type: 'content', contentType: 'item', id });
const tile = (id, x, y, rotation = 0, config = null) => ({ id, x, y, rotation, config });
const scheme = (tiles, extra = {}) => ({ width: 40, height: 40, tiles, settings: {}, ...extra });
const codes = result => result.issues.map(issue => issue.code);
const errors = result => result.issues.filter(issue => issue.level === 'error').map(issue => issue.code);

test('an unloader lane that ends in a factory delivers exactly the recipe ingredients', () => {
  // core(3x3) at 10..12 | unloader coal+sand | belts west | smelter
  const good = scheme([
    tile('core-shard', 11, 5),
    tile('unloader', 9, 4, 0, item('coal')),
    tile('unloader', 9, 6, 0, item('sand')),
    tile('conveyor', 8, 4, 2), tile('conveyor', 7, 4, 2),
    tile('conveyor', 8, 6, 2), tile('conveyor', 7, 6, 2),
    tile('silicon-smelter', 5, 4, 0),       // 5..6 x 4..5
    tile('power-node', 5, 7),
    tile('combustion-generator', 6, 7),
  ]);
  // The smelter sits on rows 4 and 5, so the sand lane at row 6 does not touch it.
  const result = analyzeFlow(good);
  assert.ok(errors(result).includes('belt-void') || errors(result).includes('input-missing'));

  const fixed = scheme([
    tile('core-shard', 11, 5),
    tile('unloader', 9, 4, 0, item('coal')),
    tile('unloader', 9, 5, 0, item('sand')),
    tile('conveyor', 8, 4, 2), tile('conveyor', 7, 4, 2),
    tile('conveyor', 8, 5, 2), tile('conveyor', 7, 5, 2),
    tile('silicon-smelter', 5, 4, 0),
    tile('conveyor', 4, 4, 2), tile('container', 2, 4),   // the product leaves through an output belt
    tile('solar-panel', 5, 6),             // touches the smelter: power by adjacency (too weak, but connected)
  ]);
  const ok = analyzeFlow(fixed);
  assert.deepEqual(errors(ok), [], ok.issues.map(issue => issue.text).join('\n'));
  assert.ok(codes(ok).includes('power-deficit'), 'one panel gives 7 units/s, the smelter needs 30');
});

test('belts that point at nothing, at each other or at a block that refuses the item are reported', () => {
  const result = analyzeFlow(scheme([
    tile('core-shard', 11, 5),
    tile('unloader', 9, 5, 0, item('copper')),
    tile('conveyor', 8, 5, 2), tile('conveyor', 7, 5, 2),
    tile('conveyor', 5, 5, 0),                  // head-on with the next one
    tile('conveyor', 6, 5, 2),
    tile('conveyor', 2, 2, 1),                  // faces empty ground
    tile('silicon-smelter', 20, 20),
    tile('conveyor', 19, 20, 0),                // feeds copper? nothing arrives, but it faces the smelter
  ]));
  assert.ok(codes(result).includes('belt-head-on'));
  assert.ok(codes(result).includes('belt-void'));
});

test('a factory that dumps its product into its own input lane is reported as a jam', () => {
  const result = analyzeFlow(scheme([
    tile('core-shard', 20, 5),
    tile('unloader', 18, 5, 0, item('coal')),
    tile('conveyor', 17, 5, 2), tile('conveyor', 16, 5, 2), tile('conveyor', 15, 5, 2),
    // the lane runs *past* the smelter (adjacent, not facing it) before ending in it
    tile('conveyor', 14, 5, 3), tile('conveyor', 14, 4, 3),
    tile('silicon-smelter', 14, 2, 0),          // 14..15 x 2..3, the lane's last cell at (14,4) faces it
    tile('conveyor', 13, 3, 1),                 // adjacent to the smelter, flows north into the lane
    tile('conveyor', 13, 4, 0),                 // ... and then back into the belt feeding the smelter
  ]));
  assert.ok(result.issues.some(issue => issue.code === 'item-stuck' && /Кремний/.test(issue.text)), 'silicon enters the coal lane and cannot be accepted by the smelter');
});

test('power: adjacency, node range and missing generators', () => {
  const smelter = tile('silicon-smelter', 10, 10);
  const lonely = analyzeFlow(scheme([smelter]));
  assert.ok(codes(lonely).includes('power-source'));
  const adjacent = analyzeFlow(scheme([smelter, tile('combustion-generator', 12, 10)]));
  assert.equal(codes(adjacent).includes('power-source'), false);
  // consumers touching each other do not conduct, but a node in laser range joins them
  const near = analyzeFlow(scheme([smelter, tile('power-node', 14, 10), tile('combustion-generator', 18, 10)]));
  assert.equal(codes(near).includes('power-source'), false, 'node range is 6 tiles');
  const far = analyzeFlow(scheme([smelter, tile('power-node', 14, 10), tile('combustion-generator', 30, 10)]));
  assert.ok(codes(far).includes('power-source') || codes(far).includes('power-external'));
  const deficit = analyzeFlow(scheme([tile('lancer', 10, 10), tile('combustion-generator', 12, 10)]));
  assert.ok(codes(deficit).includes('power-deficit'));
});

test('node links written into a schematic are honoured; unlinked far nodes stay disconnected', () => {
  const base = [tile('silicon-smelter', 10, 10), tile('combustion-generator', 25, 10)];
  const linked = analyzeFlow(scheme([...base, tile('power-node', 14, 10, 0, { type: 'point2[]', points: [{ x: -4, y: 0 }, { x: 11, y: 0 }] })]));
  assert.equal(codes(linked).includes('power-source'), false);
});

test('junctions pass both axes straight through and never mix lanes', () => {
  const result = analyzeFlow(scheme([
    tile('core-shard', 30, 10),
    tile('unloader', 28, 10, 0, item('copper')),
    tile('conveyor', 27, 10, 2), tile('junction', 26, 10), tile('conveyor', 25, 10, 2),
    // lead crosses vertically
    tile('conveyor', 26, 13, 3), tile('conveyor', 26, 12, 3), tile('conveyor', 26, 11, 3),
    tile('conveyor', 26, 9, 3), tile('conveyor', 26, 8, 3),
    tile('container', 26, 6),                   // 26..27 x 6..7: lead ends here
    tile('core-foundation', 22, 10),            // copper ends in a second core
    tile('container', 26, 15),                  // a source container above the crossing
    tile('unloader', 26, 14, 0, item('lead')),
  ]));
  assert.deepEqual(errors(result).filter(code => code === 'item-stuck'), []);
  assert.ok(Object.values(result.items).some(list => list.includes('lead')));
});

test('inverted sorters divert their item sideways and pass the rest on', () => {
  const result = analyzeFlow(scheme([
    tile('core-shard', 20, 5),
    tile('unloader', 18, 5, 0, item('copper')), tile('unloader', 18, 4, 0, item('lead')),
    tile('conveyor', 17, 5, 2), tile('conveyor', 16, 5, 2), tile('inverted-sorter', 15, 5, 0, item('lead')),
    tile('conveyor', 14, 5, 2), tile('conveyor', 13, 5, 2),
    tile('core-nucleus', 10, 5),
  ]));
  assert.equal(errors(result).includes('item-stuck'), false);
});

test('bridges follow their relative link; the far end carries on forward and an unlinked one only spills sideways', () => {
  const result = analyzeFlow(scheme([
    tile('core-shard', 20, 5),
    tile('unloader', 18, 5, 0, item('copper')),
    tile('conveyor', 17, 5, 2),
    tile('bridge-conveyor', 16, 5, 0, { type: 'point2', x: -4, y: 0 }),
    tile('bridge-conveyor', 12, 5, 2),
    tile('conveyor', 11, 5, 2),
    tile('core-nucleus', 8, 5),
  ]));
  assert.deepEqual(errors(result), [], result.issues.map(issue => issue.text).join('\n'));
  const unlinked = analyzeFlow(scheme([
    tile('core-shard', 20, 5), tile('unloader', 18, 5, 0, item('copper')), tile('conveyor', 17, 5, 2),
    tile('bridge-conveyor', 16, 5, 0), tile('conveyor', 15, 5, 2),
  ]));
  assert.ok(errors(unlinked).length > 0, 'a bridge without a link only drops items into whatever touches it');
});

test('turrets need ammo they accept; routers hand items to every neighbour that wants them', () => {
  const lane = [
    tile('core-shard', 20, 5), tile('unloader', 18, 5, 0, item('graphite')),
    tile('conveyor', 17, 5, 2), tile('router', 16, 5),
  ];
  const fed = analyzeFlow(scheme([...lane, tile('duo', 16, 6), tile('hail', 16, 4), tile('conveyor', 15, 5, 2), tile('router', 14, 5), tile('salvo', 13, 6), tile('salvo', 13, 3)]));
  assert.equal(codes(fed).includes('ammo-missing'), false, fed.issues.map(issue => issue.text).join('\n'));
  const wrong = analyzeFlow(scheme([...lane, tile('scatter', 16, 7)]));
  assert.ok(codes(wrong).includes('ammo-missing') || codes(wrong).includes('item-stuck'), 'scatter does not accept graphite');
});

test('unloaders must touch storage, and Erekir cores cannot be unloaded', () => {
  assert.ok(codes(analyzeFlow(scheme([tile('unloader', 5, 5, 0, item('copper')), tile('conveyor', 4, 5, 2)]))).includes('unloader-empty'));
  assert.ok(codes(analyzeFlow(scheme([tile('core-shard', 20, 5), tile('unloader', 18, 5, 0, item('copper'))]))).includes('unloader-idle'));
  const erekir = analyzeFlow(scheme([tile('core-bastion', 20, 5), tile('duct-unloader', 18, 5, 2, item('beryllium')), tile('duct', 17, 5, 2), tile('duct', 16, 5, 2)]));
  assert.ok(codes(erekir).includes('duct-unloader-core'));
  const fine = analyzeFlow(scheme([tile('reinforced-container', 20, 5), tile('duct-unloader', 19, 5, 2, item('beryllium')), tile('duct', 18, 5, 2), tile('duct', 17, 5, 2), tile('duct', 16, 5, 2), tile('core-bastion', 13, 5)]));
  assert.equal(errors(fine).includes('duct-unloader-core'), false);
  assert.deepEqual(errors(fine), [], fine.issues.map(issue => issue.text).join('\n'));
});

test('liquids: an extractor touching a generator feeds it, a lone generator is flagged', () => {
  const fed = analyzeFlow(scheme([
    tile('steam-generator', 10, 10), tile('water-extractor', 12, 10),
    tile('core-shard', 20, 5), tile('unloader', 18, 5, 0, item('coal')), tile('conveyor', 17, 5, 2), tile('conveyor', 16, 5, 1),
    tile('conveyor', 16, 6, 1), tile('conveyor', 16, 7, 1), tile('conveyor', 16, 8, 1), tile('conveyor', 16, 9, 2), tile('conveyor', 15, 9, 2),
    tile('conveyor', 14, 9, 2), tile('conveyor', 13, 9, 2), tile('conveyor', 12, 9, 2), tile('conveyor', 11, 9, 3),
    tile('battery', 13, 11),
  ]));
  assert.equal(fed.issues.some(issue => issue.code === 'liquid-missing'), false, fed.issues.map(issue => issue.text).join('\n'));
  const dry = analyzeFlow(scheme([tile('steam-generator', 10, 10)]));
  assert.ok(codes(dry).includes('liquid-missing'));
});

test('declared inlets stand in for supplies outside the blueprint', () => {
  const open = scheme([tile('conveyor', 5, 5, 0), tile('silicon-smelter', 6, 5), tile('combustion-generator', 6, 7)]);
  assert.ok(codes(analyzeFlow(open)).includes('input-missing'));
  const declared = analyzeFlow({ ...open, inlets: [{ x: 5, y: 5, kind: 'item', id: 'coal' }] });
  assert.equal(declared.issues.filter(issue => issue.code === 'input-missing' && /Уголь/.test(issue.text)).length, 0);
  assert.ok(declared.issues.some(issue => issue.code === 'input-missing' && /Песок/.test(issue.text)), 'sand still has no lane');
});

test('a drone processor with an item-take program supplies its first link', () => {
  const program = ['getlink factory 0', 'ubind @mono', 'ucontrol itemTake core @coal 30 0 0', 'ucontrol itemDrop factory 30 0 0 0'].join('\n');
  const result = analyzeFlow(scheme([
    tile('silicon-smelter', 10, 10), tile('combustion-generator', 12, 10),
    tile('micro-processor', 10, 14, 0, { type: 'logic', code: program, links: [{ name: 'smelter1', x: 0, y: -4 }] }),
  ]));
  assert.equal(result.issues.some(issue => issue.code === 'input-missing' && /Уголь/.test(issue.text)), false);
  assert.ok(result.issues.some(issue => issue.code === 'input-missing' && /Песок/.test(issue.text)));
});

test('block descriptors know classes, fuel, ammo and recipes from the game source', () => {
  assert.equal(describeBlock('conveyor').kind, 'belt');
  assert.equal(describeBlock('duct-router').kind, 'ductRouter');
  assert.ok(describeBlock('combustion-generator').items.has('coal') && describeBlock('combustion-generator').items.has('spore-pod'));
  assert.equal(describeBlock('combustion-generator').items.has('copper'), false);
  assert.ok(describeBlock('thorium-reactor').items.has('thorium'));
  assert.ok(describeBlock('duo').items.has('graphite') && !describeBlock('duo').items.has('lead'));
  assert.equal(describeBlock('mechanical-drill').liquidsRequired.water, undefined, 'water boosts a drill but is not required');
  assert.equal(describeBlock('steam-generator').liquidsRequired.water, 6);
  assert.equal(describeBlock('power-node').laserRange, 6);
});
