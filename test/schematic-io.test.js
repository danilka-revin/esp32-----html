import test from 'node:test';
import assert from 'node:assert/strict';
import { unzlibSync } from 'fflate';
import { decodeLogicConfig, decodeSchematic, encodeLogicConfig, encodeSchematic } from '../src/schematic-io.js';
import { generateLayout, initialSettings } from '../src/generator.js';

const sample = {
  width: 12, height: 9, name: 'тест', tags: {}, settings: {},
  tiles: [
    { id: 'micro-processor', x: 4, y: 3, rotation: 0, config: { type: 'logic', code: 'getlink core 0\nprint "Медь: "\nprintflush message1', links: [{ name: 'core1', x: 3, y: -2 }, { name: 'message1', x: -1, y: 2 }] } },
    { id: 'power-node', x: 6, y: 3, rotation: 0, config: { type: 'point2[]', points: [{ x: -2, y: 0 }, { x: 0, y: 2 }, { x: 4, y: -3 }] } },
    { id: 'bridge-conveyor', x: 5, y: 6, rotation: 0, config: { type: 'point2', x: 3, y: 0 } },
    { id: 'bridge-conveyor', x: 8, y: 6, rotation: 0, config: null },
    { id: 'ground-factory', x: 10, y: 6, rotation: 2, config: 1 },
    { id: 'message', x: 1, y: 6, rotation: 0, config: 'Привет, мир' },
    { id: 'switch', x: 1, y: 5, rotation: 0, config: true },
    { id: 'unloader', x: 2, y: 2, rotation: 0, config: { type: 'content', contentType: 'item', id: 'graphite' } },
  ],
};

test('every configuration kind written by the generator survives a .msch round trip', () => {
  const decoded = decodeSchematic(encodeSchematic(sample));
  const byId = (id, index = 0) => decoded.tiles.filter(tile => tile.id === id)[index];
  assert.deepEqual(byId('micro-processor').config, sample.tiles[0].config);
  assert.deepEqual(byId('power-node').config, sample.tiles[1].config);
  assert.deepEqual(byId('bridge-conveyor', 0).config, { type: 'point2', x: 3, y: 0 });
  assert.equal(byId('bridge-conveyor', 1).config, null);
  assert.equal(byId('ground-factory').config, 1);
  assert.equal(byId('message').config, 'Привет, мир');
  assert.equal(byId('switch').config, true);
  assert.deepEqual(byId('unloader').config, sample.tiles[7].config);
});

test('processor configuration is byte-compatible with LogicBlock.compress', () => {
  const bytes = encodeLogicConfig('end', [{ name: 'cell1', x: -2, y: 5 }]);
  const raw = unzlibSync(bytes);
  assert.equal(raw[0], 1, 'config format version');
  assert.deepEqual([...raw.slice(1, 5)], [0, 0, 0, 3], 'code length as int');
  assert.equal(new TextDecoder().decode(raw.slice(5, 8)), 'end');
  assert.deepEqual([...raw.slice(8, 12)], [0, 0, 0, 1], 'one link');
  assert.deepEqual([...raw.slice(12, 14)], [0, 5], 'writeUTF length');
  assert.equal(new TextDecoder().decode(raw.slice(14, 19)), 'cell1');
  assert.deepEqual([...raw.slice(19, 23)], [0xff, 0xfe, 0, 5], 'relative x/y as shorts');
  assert.deepEqual(decodeLogicConfig(bytes), { type: 'logic', code: 'end', links: [{ name: 'cell1', x: -2, y: 5 }] });
  assert.equal(decodeLogicConfig(new Uint8Array([1, 2, 3])), null);
});

test('unknown configuration types are preserved byte for byte instead of being dropped', () => {
  // Hand-build a schematic whose single block has a float config (type 3) that this editor does not model.
  const decoded = decodeSchematic(encodeSchematic({ ...sample, tiles: [{ id: 'router', x: 0, y: 0, rotation: 0, config: { type: 'raw', base64: btoa(String.fromCharCode(3, 0x3f, 0x80, 0, 0)) } }] }));
  assert.equal(decoded.tiles[0].config.type, 'raw');
  const again = decodeSchematic(encodeSchematic(decoded));
  assert.deepEqual(again.tiles[0].config, decoded.tiles[0].config);
});

test('export uses the tight bounding box of the buildings, like Mindustry itself', () => {
  const padded = { width: 40, height: 30, name: 'x', tags: {}, settings: {}, tiles: [
    { id: 'silicon-smelter', x: 10, y: 12, rotation: 0, config: null },     // 10..11 x 12..13
    { id: 'conveyor', x: 14, y: 12, rotation: 0, config: null },
  ] };
  const decoded = decodeSchematic(encodeSchematic(padded));
  assert.deepEqual([decoded.width, decoded.height], [5, 2]);
  assert.deepEqual(decoded.tiles.map(tile => [tile.x, tile.y]), [[0, 0], [4, 0]]);
});

test('a generated blueprint with nodes, bridges and processors exports without losing links', () => {
  for (const settings of [
    { direction: 'logistics', goal: 'conveyor', variant: 2 },
    { direction: 'logic', goal: 'processor' },
    { direction: 'mining', goal: 'thorium', stage: 'late' },
  ]) {
    const scheme = generateLayout({ ...initialSettings, minimal: false, ...settings });
    const decoded = decodeSchematic(encodeSchematic(scheme));
    assert.equal(decoded.tiles.length, scheme.tiles.length);
    assert.deepEqual(decoded.tiles.map(tile => tile.config), scheme.tiles.map(tile => tile.config), `${settings.direction}: configs`);
    assert.ok(decoded.tiles.some(tile => tile.config != null), `${settings.direction}: has configured blocks`);
  }
});
