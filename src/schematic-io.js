import { zlibSync, unzlibSync } from 'fflate';
import { blockById } from './catalog.js';

const MAGIC = [0x6d, 0x73, 0x63, 0x68]; // "msch"
const VERSION = 1;
const MINDUSTRY_ITEM_IDS = Object.freeze({
  copper: 0, lead: 1, metaglass: 2, graphite: 3, sand: 4, coal: 5, titanium: 6, thorium: 7,
  scrap: 8, silicon: 9, plastanium: 10, 'phase-fabric': 11, 'surge-alloy': 12, 'spore-pod': 13,
  'blast-compound': 14, pyratite: 15, beryllium: 16, tungsten: 17, oxide: 18, carbide: 19,
  'fissile-matter': 20, 'dormant-cyst': 21,
});
const ITEM_IDS_BY_MINDUSTRY_ID = new Map(Object.entries(MINDUSTRY_ITEM_IDS).map(([id, contentId]) => [contentId, id]));
const MINDUSTRY_CONTENT_TYPE_IDS = Object.freeze({ item: 0, block: 1, bullet: 3, liquid: 4, status: 5, unit: 6, weather: 7, sector: 9, planet: 13 });

class Writer {
  constructor() { this.data = []; }
  byte(value) { this.data.push(value & 0xff); }
  short(value) {
    this.byte(value >>> 8);
    this.byte(value);
  }
  int(value) {
    this.byte(value >>> 24);
    this.byte(value >>> 16);
    this.byte(value >>> 8);
    this.byte(value);
  }
  bytes(value) { for (const byte of value) this.byte(byte); }
  utf(value) {
    const text = String(value ?? '');
    const encoded = [];
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code >= 0x0001 && code <= 0x007f) {
        encoded.push(code);
      } else if (code <= 0x07ff) {
        encoded.push(0xc0 | ((code >> 6) & 0x1f), 0x80 | (code & 0x3f));
      } else {
        encoded.push(0xe0 | ((code >> 12) & 0x0f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    if (encoded.length > 65535) throw new Error('Слишком длинное текстовое поле в схеме.');
    this.short(encoded.length);
    this.bytes(encoded);
  }
  finish() { return Uint8Array.from(this.data); }
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.offset = 0;
  }
  ensure(length) {
    if (this.offset + length > this.bytes.length) throw new Error('Файл схемы обрезан или повреждён.');
  }
  byte() { this.ensure(1); return this.bytes[this.offset++]; }
  short() { this.ensure(2); const value = (this.bytes[this.offset] << 8) | this.bytes[this.offset + 1]; this.offset += 2; return value > 32767 ? value - 65536 : value; }
  unsignedShort() { this.ensure(2); const value = (this.bytes[this.offset] << 8) | this.bytes[this.offset + 1]; this.offset += 2; return value; }
  int() {
    this.ensure(4);
    const value = ((this.bytes[this.offset] << 24) | (this.bytes[this.offset + 1] << 16) | (this.bytes[this.offset + 2] << 8) | this.bytes[this.offset + 3]) >>> 0;
    this.offset += 4;
    return value > 0x7fffffff ? value - 0x100000000 : value;
  }
  skip(length) { this.ensure(length); this.offset += length; }
  utf() {
    const length = this.unsignedShort();
    this.ensure(length);
    const end = this.offset + length;
    const units = [];
    while (this.offset < end) {
      const first = this.byte();
      if ((first & 0x80) === 0) {
        units.push(first);
      } else if ((first & 0xe0) === 0xc0) {
        const second = this.byte();
        units.push(((first & 0x1f) << 6) | (second & 0x3f));
      } else {
        const second = this.byte();
        const third = this.byte();
        units.push(((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f));
      }
    }
    let output = '';
    for (let index = 0; index < units.length; index += 8192) output += String.fromCharCode(...units.slice(index, index + 8192));
    return output;
  }
}

function writeMindustryObject(writer, config) {
  if (config == null) {
    writer.byte(0);
    return;
  }
  if (config?.type === 'content') {
    const contentType = typeof config.contentType === 'number'
      ? config.contentType
      : MINDUSTRY_CONTENT_TYPE_IDS[config.contentType ?? 'item'];
    const contentId = typeof config.id === 'number'
      ? config.id
      : contentType === 0 ? MINDUSTRY_ITEM_IDS[config.id] : undefined;
    if (!Number.isInteger(contentType) || contentType < 0 || contentType > 255 || !Number.isInteger(contentId) || contentId < 0 || contentId > 32767) {
      throw new Error(`Неизвестная конфигурация содержимого «${config.id ?? ''}».`);
    }
    writer.byte(5);
    writer.byte(contentType);
    writer.short(contentId);
    return;
  }
  if (typeof config === 'number' && Number.isInteger(config)) {
    writer.byte(1);
    writer.int(config);
    return;
  }
  if (typeof config === 'string') {
    writer.byte(4);
    writer.byte(1);
    writer.utf(config);
    return;
  }
  // Untyped / unsupported configs are intentionally exported as null. The game
  // can still place every tile; the user can configure it after pasting.
  writer.byte(0);
}

function readMindustryObject(reader) {
  const type = reader.byte();
  switch (type) {
    case 0: return null;
    case 1: reader.skip(4); return null;
    case 2: reader.skip(8); return null;
    case 3: reader.skip(4); return null;
    case 4: {
      const exists = reader.byte();
      if (exists) reader.utf();
      return null;
    }
    case 5: {
      const contentType = reader.byte();
      const contentId = reader.short();
      if (contentType === 0) {
        return { type: 'content', contentType: 'item', id: ITEM_IDS_BY_MINDUSTRY_ID.get(contentId) ?? contentId };
      }
      return { type: 'content', contentType, id: contentId };
    }
    case 6: { const count = reader.short(); if (count < 0) throw new Error('Некорректный массив в конфигурации блока.'); reader.skip(count * 4); return null; }
    case 7: reader.skip(8); return null;
    case 8: { const count = reader.byte(); reader.skip(count * 4); return null; }
    case 9: reader.skip(3); return null;
    case 10: reader.skip(1); return null;
    case 11: reader.skip(8); return null;
    case 12: reader.skip(4); return null;
    case 13: reader.skip(2); return null;
    case 14: { const count = reader.int(); if (count < 0 || count > reader.bytes.length) throw new Error('Некорректные данные блока.'); reader.skip(count); return null; }
    case 15: reader.skip(1); return null;
    case 16: { const count = reader.int(); if (count < 0 || count > reader.bytes.length) throw new Error('Некорректные данные блока.'); reader.skip(count); return null; }
    case 17: reader.skip(4); return null;
    case 18: { const count = reader.short(); if (count < 0) throw new Error('Некорректный массив координат.'); reader.skip(count * 8); return null; }
    case 19: reader.skip(8); return null;
    case 20: reader.skip(1); return null;
    case 21: { const count = reader.short(); if (count < 0) throw new Error('Некорректный массив целых чисел.'); reader.skip(count * 4); return null; }
    case 22: {
      const count = reader.int();
      if (count < 0 || count > 10000) throw new Error('Слишком большой массив конфигурации.');
      for (let index = 0; index < count; index += 1) readMindustryObject(reader);
      return null;
    }
    case 23: reader.skip(2); return null;
    default: throw new Error(`Неизвестный тип конфигурации в схеме (${type}).`);
  }
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function base64FromBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
  }
  return btoa(binary);
}

function bytesFromBase64(value) {
  const normalized = value.trim().replace(/^data:.*?;base64,/, '').replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeSchematic(scheme) {
  if (!scheme || !Array.isArray(scheme.tiles)) throw new Error('Нет данных схемы для экспорта.');
  if (scheme.width > 128 || scheme.height > 128) throw new Error('Mindustry поддерживает схемы не больше 128 × 128.');
  const tiles = scheme.tiles.filter((tile) => tile?.id && tile.id !== 'air');
  const dictionary = [...new Set(tiles.map((tile) => tile.id))];
  if (dictionary.length > 255) throw new Error('В схеме слишком много уникальных типов блоков.');
  if (tiles.length > 128 * 128) throw new Error('В схеме слишком много построек.');

  const title = String(scheme.name ?? scheme.tags?.name ?? 'Новая схема').slice(0, 120);
  const tags = {
    name: title,
    description: String(scheme.description ?? scheme.tags?.description ?? 'Собрано в Bee Schematic Lab').slice(0, 400),
    labels: JSON.stringify(['Mindustry v146', 'Bee Schematic Lab']),
  };
  const metadata = scheme.tags ?? {};
  const settings = scheme.settings ?? {};
  const planet = metadata.planet ?? settings.planet;
  const direction = metadata.direction ?? settings.direction;
  const goal = metadata.goal ?? settings.goal;
  const supplyMode = metadata.supplyMode ?? settings.supplyMode;
  const processorControl = metadata.processorControl ?? settings.processorControl;
  const droneUnit = metadata.droneUnit ?? settings.droneUnit;
  const transportItem = metadata.transportItem ?? settings.transportItem;
  const reserveThreshold = metadata.reserveThreshold ?? settings.reserveThreshold;
  const droneCapacity = metadata.droneCapacity ?? settings.droneCapacity;
  if (planet) tags.planet = String(planet);
  if (direction) tags.direction = String(direction);
  if (goal) tags.goal = String(goal);
  if (supplyMode) tags.supplyMode = String(supplyMode);
  if (processorControl !== undefined) tags.processorControl = String(processorControl);
  if (droneUnit) tags.droneUnit = String(droneUnit);
  if (transportItem) tags.transportItem = String(transportItem);
  if (reserveThreshold !== undefined) tags.reserveThreshold = String(reserveThreshold);
  if (droneCapacity !== undefined) tags.droneCapacity = String(droneCapacity);

  const writer = new Writer();
  writer.short(scheme.width);
  writer.short(scheme.height);
  const entries = Object.entries(tags);
  writer.byte(entries.length);
  for (const [key, value] of entries) { writer.utf(key); writer.utf(value); }
  writer.byte(dictionary.length);
  for (const id of dictionary) writer.utf(id);
  writer.int(tiles.length);
  for (const tile of tiles) {
    writer.byte(dictionary.indexOf(tile.id));
    const packed = (((tile.x & 0xffff) << 16) | (tile.y & 0xffff)) >>> 0;
    writer.int(packed);
    writeMindustryObject(writer, tile.config ?? null);
    writer.byte(tile.rotation ?? 0);
  }
  const compressed = zlibSync(writer.finish(), { level: 6 });
  return concatBytes(Uint8Array.from([...MAGIC, VERSION]), compressed);
}

export function schematicToBase64(scheme) {
  return base64FromBytes(encodeSchematic(scheme));
}

export function downloadSchematic(scheme) {
  const bytes = encodeSchematic(scheme);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const fileName = (scheme.name || 'mindustry-scheme').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'mindustry-scheme';
  anchor.href = url;
  anchor.download = `${fileName}.msch`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function decodeSchematic(input) {
  let bytes;
  if (typeof input === 'string') {
    bytes = bytesFromBase64(input.replace(/^\s*```(?:[a-z]+)?/i, '').replace(/```\s*$/, ''));
  } else {
    bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  }
  if (bytes.length < 8 || MAGIC.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('Это не Mindustry-схема: заголовок msch не найден.');
  }
  const version = bytes[4];
  if (version > VERSION) throw new Error(`Версия схемы ${version} пока не поддерживается.`);
  const raw = unzlibSync(bytes.subarray(5));
  const reader = new Reader(raw);
  const width = reader.short();
  const height = reader.short();
  if (width < 1 || height < 1 || width > 128 || height > 128) throw new Error('Некорректный размер схемы.');
  const tagCount = reader.byte();
  const tags = {};
  for (let index = 0; index < tagCount; index += 1) tags[reader.utf()] = reader.utf();
  const blockCount = reader.byte();
  const dictionary = [];
  for (let index = 0; index < blockCount; index += 1) dictionary.push(reader.utf());
  const total = reader.int();
  if (total < 0 || total > 128 * 128) throw new Error('Схема содержит недопустимое число построек.');
  const tiles = [];
  for (let index = 0; index < total; index += 1) {
    const blockIndex = reader.byte();
    const id = dictionary[blockIndex];
    const packed = reader.int() >>> 0;
    const x = (packed >>> 16) > 0x7fff ? (packed >>> 16) - 0x10000 : (packed >>> 16);
    const rawY = packed & 0xffff;
    const y = rawY > 0x7fff ? rawY - 0x10000 : rawY;
    const config = version === 0 ? (reader.skip(4), null) : readMindustryObject(reader);
    const rotation = reader.byte() & 0xff;
    if (!id) throw new Error('Схема ссылается на отсутствующий блок.');
    if (id !== 'air') tiles.push({ id, x, y, rotation: rotation % 4, config });
  }
  const name = tags.name || 'Импортированная схема';
  return {
    width,
    height,
    tiles,
    name,
    description: tags.description || 'Импортировано из файла .msch',
    tags,
    settings: {
      planet: tags.planet === 'erekir' ? 'erekir' : 'serpulo',
      ...(tags.direction ? { direction: tags.direction } : {}),
      ...(tags.goal ? { goal: tags.goal } : {}),
      ...(tags.supplyMode ? { supplyMode: tags.supplyMode } : {}),
      ...(tags.processorControl !== undefined ? { processorControl: tags.processorControl === 'true' } : {}),
      ...(tags.droneUnit ? { droneUnit: tags.droneUnit } : {}),
      ...(tags.transportItem ? { transportItem: tags.transportItem } : {}),
      ...(tags.reserveThreshold ? { reserveThreshold: Number(tags.reserveThreshold) || 40 } : {}),
      ...(tags.droneCapacity ? { droneCapacity: Number(tags.droneCapacity) || 50 } : {}),
    },
  };
}

export async function decodeSchematicFile(file) {
  return decodeSchematic(new Uint8Array(await file.arrayBuffer()));
}

export function getExportWarnings(scheme) {
  const missing = [...new Set(scheme.tiles.map((tile) => tile.id).filter((id) => !blockById.has(id)))];
  return missing;
}
