/**
 * `config2` — the binary settings/data format used by every pre-NCPF save file
 * (`settings.dat`, LegacyNCPF v1–v11, and the localisation-era settings).
 *
 * Ported from `src/net/ncplanner/plannerator/config2/*.java`. This is a **read**
 * implementation: R2 only ever reads config2 (the rewrite writes JSON), so no
 * writer is provided.
 *
 * Wire format (big-endian, `DataInputStream` semantics):
 *
 * ```
 * short version                       // 0 = pre-OneType, 1 = current (2 = ConfigMulti, rejected)
 * { byte type; <payload>; utf key }*  // repeated until type byte 0
 * byte 0
 * ```
 *
 * `type` indexes `ConfigBase.newConfig`:
 *
 * | index | type | payload |
 * |---|---|---|
 * | 1 | Config (object) | the same `{type,payload,key}*` loop, terminated by 0 |
 * | 2 | String | modified-UTF (2-byte length + bytes) |
 * | 3 | Integer | int32 |
 * | 4 | Float | float32 |
 * | 5 | Boolean | 1 byte |
 * | 6 | Long | int64 |
 * | 7 | Double | float64 |
 * | 8 | (HugeLong, removed) | throws |
 * | 9 | ConfigList | see below |
 * | 10 | Byte | 1 byte |
 * | 11 | Short | int16 |
 * | 12 | ConfigNumberList | see below |
 *
 * Two details are easy to get wrong and are reproduced exactly:
 *
 *  1. **The key is written *after* the payload** (`Config.write` writes the type,
 *     the payload, then `writeUTF(key)`, "because that's how it's being read").
 *  2. **`get(key, defaultValue)` mutates the config** — Java calls `set(key, value)`
 *     when the key is absent, which appends it to the ordered key list. The
 *     legacy readers depend on that order, so {@link ConfigObject.getOr} does the
 *     same.
 */
import { readFileSync } from 'node:fs';

export class Config2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Config2Error';
  }
}

/** Java `ConfigBase.newConfig` type indices. */
export const enum ConfigType {
  Object = 1,
  String = 2,
  Integer = 3,
  Float = 4,
  Boolean = 5,
  Long = 6,
  Double = 7,
  HugeLong = 8,
  List = 9,
  Byte = 10,
  Short = 11,
  NumberList = 12,
}

export type ConfigValue = ConfigObject | ConfigList | ConfigNumberList | string | number | bigint | boolean;

/** A big-endian reader over a `Uint8Array`, mirroring `DataInputStream`. */
export class DataReader {
  private offset = 0;

  constructor(
    private readonly bytes: Uint8Array,
    public readonly label = '<config2>',
  ) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private need(count: number): void {
    if (this.offset + count > this.bytes.length) {
      throw new Config2Error(
        `${this.label}: unexpected end of data at ${this.offset} (need ${count} more bytes)`,
      );
    }
  }

  readByte(): number {
    this.need(1);
    return this.bytes[this.offset++]!;
  }

  /** Java `DataInputStream.readByte` is signed. */
  readSignedByte(): number {
    const b = this.readByte();
    return b > 127 ? b - 256 : b;
  }

  readShort(): number {
    this.need(2);
    const value = (this.bytes[this.offset]! << 8) | this.bytes[this.offset + 1]!;
    this.offset += 2;
    return value > 0x7fff ? value - 0x10000 : value;
  }

  readInt(): number {
    this.need(4);
    const b = this.bytes;
    const o = this.offset;
    this.offset += 4;
    return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) | 0;
  }

  readLong(): bigint {
    this.need(8);
    let value = 0n;
    for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(this.bytes[this.offset + i]!);
    this.offset += 8;
    if (value >= 0x8000000000000000n) value -= 0x10000000000000000n;
    return value;
  }

  readFloat(): number {
    this.need(4);
    const buffer = Buffer.from(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      4,
    );
    this.offset += 4;
    return buffer.readFloatBE(0);
  }

  readDouble(): number {
    this.need(8);
    const buffer = Buffer.from(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      8,
    );
    this.offset += 8;
    return buffer.readDoubleBE(0);
  }

  /**
   * Java `DataInputStream.readUTF`: a 2-byte unsigned length followed by
   * *modified* UTF-8. Modified UTF-8 encodes NUL as `C0 80` and supplementary
   * characters as CESU-8; decoding as standard UTF-8 is correct for every string
   * this format actually carries (identifiers, names, file paths), and the
   * `C0 80` case is handled explicitly.
   */
  readUtf(): string {
    const length = this.readShort() & 0xffff;
    this.need(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    if (!slice.includes(0xc0)) return new TextDecoder('utf-8').decode(slice);
    const bytes: number[] = [];
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i]!;
      if (b === 0xc0 && slice[i + 1] === 0x80) {
        bytes.push(0);
        i++;
      } else {
        bytes.push(b);
      }
    }
    return new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
  }
}

/** Java `Config` — an ordered string-keyed object. */
export class ConfigObject {
  private readonly keys: string[] = [];
  private readonly data = new Map<string, ConfigValue>();

  /** Insertion order, exactly like Java's `ArrayList<String> keys`. */
  properties(): string[] {
    return [...this.keys];
  }

  hasProperty(key: string): boolean {
    return this.data.has(key);
  }

  /** Java `Config.get(String)`: the unwrapped value, or `null`. */
  get(key: string): unknown {
    const value = this.data.get(key);
    return value === undefined ? null : value;
  }

  /**
   * Java `Config.get(String, V)`: **sets and returns** the default when absent
   * (which is observable through `properties()` and therefore through the
   * positional references of the legacy format).
   */
  getOr<T>(key: string, defaultValue: T): T | unknown {
    if (!this.data.has(key)) {
      this.setValue(key, defaultValue as ConfigValue);
      return defaultValue;
    }
    return this.data.get(key);
  }

  getObject(key: string): ConfigObject | null {
    const value = this.data.get(key);
    return value instanceof ConfigObject ? value : null;
  }

  getList(key: string): ConfigList | null {
    const value = this.data.get(key);
    return value instanceof ConfigList ? value : null;
  }

  getNumberList(key: string): ConfigNumberList | null {
    const value = this.data.get(key);
    return value instanceof ConfigNumberList ? value : null;
  }

  /** Java `Config.getConfigNumberList(String)`. */
  getConfigNumberList(key: string): ConfigNumberList | null {
    return this.getNumberList(key);
  }

  /** Java `Config.getConfigList(String)`. */
  getConfigList(key: string): ConfigList | null {
    return this.getList(key);
  }

  getString(key: string): string | null;
  getString(key: string, defaultValue: string): string;
  getString(key: string, defaultValue?: string): string | null {
    if (!this.data.has(key)) {
      if (defaultValue === undefined) return null;
      this.setValue(key, defaultValue);
      return defaultValue;
    }
    const value = this.data.get(key);
    return typeof value === 'string' ? value : null;
  }

  getInt(key: string): number;
  getInt(key: string, defaultValue: number): number;
  getInt(key: string, defaultValue?: number): number {
    if (!this.data.has(key) && defaultValue !== undefined) {
      this.setValue(key, defaultValue);
      return defaultValue;
    }
    return Math.trunc(this.number(key));
  }

  getByte(key: string): number;
  getByte(key: string, defaultValue: number): number;
  getByte(key: string, defaultValue?: number): number {
    // Java `getByte` unboxes a `Byte`; the value is already in signed range.
    if (defaultValue !== undefined) return this.getInt(key, defaultValue);
    return this.getInt(key);
  }

  getShort(key: string): number;
  getShort(key: string, defaultValue: number): number;
  getShort(key: string, defaultValue?: number): number {
    if (defaultValue !== undefined) return this.getInt(key, defaultValue);
    return this.getInt(key);
  }

  getLong(key: string): bigint;
  getLong(key: string, defaultValue: bigint): bigint;
  getLong(key: string, defaultValue?: bigint): bigint {
    const value = this.data.get(key);
    if (value === undefined && defaultValue !== undefined) {
      this.setValue(key, defaultValue);
      return defaultValue;
    }
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(Math.trunc(value));
    throw new Config2Error(`config2: "${key}" is not a long (${describe(value)})`);
  }

  getFloat(key: string): number;
  getFloat(key: string, defaultValue: number): number;
  getFloat(key: string, defaultValue?: number): number {
    if (!this.data.has(key) && defaultValue !== undefined) {
      this.setValue(key, defaultValue);
      return defaultValue;
    }
    return this.number(key);
  }

  getDouble(key: string): number;
  getDouble(key: string, defaultValue: number): number;
  getDouble(key: string, defaultValue?: number): number {
    if (!this.data.has(key) && defaultValue !== undefined) {
      this.setValue(key, defaultValue);
      return defaultValue;
    }
    return this.number(key);
  }

  getBoolean(key: string): boolean;
  getBoolean(key: string, defaultValue: boolean): boolean;
  getBoolean(key: string, defaultValue?: boolean): boolean {
    const value = this.data.get(key);
    if (value === undefined && defaultValue !== undefined) {
      this.setValue(key, defaultValue);
      return defaultValue;
    }
    if (typeof value === 'boolean') return value;
    throw new Config2Error(`config2: "${key}" is not a boolean (${describe(value)})`);
  }

  /** Java `Config.getAsInt` and friends go through `Number`. */
  getAsInt(key: string): number {
    return Math.trunc(this.number(key));
  }

  getAsFloat(key: string): number {
    return this.number(key);
  }

  getAsDouble(key: string): number {
    return this.number(key);
  }

  getAsByte(key: string): number {
    return Math.trunc(this.number(key));
  }

  getAsShort(key: string): number {
    return Math.trunc(this.number(key));
  }

  private number(key: string): number {
    const value = this.data.get(key);
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    throw new Config2Error(`config2: "${key}" is not a number (${describe(value)})`);
  }

  /** Java `Config.set(String, Object)` for the types the readers use. */
  setValue(key: string, value: ConfigValue): void {
    if (!this.keys.includes(key)) this.keys.push(key);
    this.data.set(key, value);
  }

  /** Java `Config.removeProperty`. */
  removeProperty(key: string): ConfigValue | undefined {
    const value = this.data.get(key);
    this.data.delete(key);
    const index = this.keys.indexOf(key);
    if (index >= 0) this.keys.splice(index, 1);
    return value;
  }

  /** Diagnostics only: a plain JSON view (no bigints). */
  toJson(): unknown {
    const out: Record<string, unknown> = {};
    for (const key of this.keys) out[key] = jsonView(this.data.get(key));
    return out;
  }
}

/** Java `ConfigList` — a heterogeneous list. */
export class ConfigList {
  constructor(readonly items: ConfigValue[] = []) {}

  size(): number {
    return this.items.length;
  }

  get(index: number): unknown {
    return this.items[index] ?? null;
  }

  getObject(index: number): ConfigObject {
    const value = this.items[index];
    if (!(value instanceof ConfigObject)) {
      throw new Config2Error(`config2: list[${index}] is not a config (${describe(value)})`);
    }
    return value;
  }

  getList(index: number): ConfigList | null {
    const value = this.items[index];
    return value instanceof ConfigList ? value : null;
  }

  getString(index: number): string | null {
    const value = this.items[index];
    return typeof value === 'string' ? value : null;
  }

  getInt(index: number): number {
    return this.getAsInt(index);
  }

  getByte(index: number): number {
    return this.getAsInt(index);
  }

  getShort(index: number): number {
    return this.getAsInt(index);
  }

  getAsInt(index: number): number {
    const value = this.items[index];
    if (typeof value === 'number') return Math.trunc(value);
    if (typeof value === 'bigint') return Number(value);
    throw new Config2Error(`config2: list[${index}] is not a number (${describe(value)})`);
  }

  getAsFloat(index: number): number {
    const value = this.items[index];
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    throw new Config2Error(`config2: list[${index}] is not a number (${describe(value)})`);
  }

  getAsDouble(index: number): number {
    return this.getAsFloat(index);
  }

  /** Non-throwing variant used where Java's unchecked cast would throw. */
  tryObject(index: number): ConfigObject | null {
    const value = this.items[index];
    return value instanceof ConfigObject ? value : null;
  }
}

/** Java `ConfigNumberList` — a bit-packed list of longs. */
export class ConfigNumberList {
  constructor(readonly values: bigint[] = []) {}

  size(): number {
    return this.values.length;
  }

  /** Java returns `0` for out-of-range indices. */
  get(index: number): number {
    const value = this.values[index];
    return value === undefined ? 0 : Number(value);
  }

  getLong(index: number): bigint {
    return this.values[index] ?? 0n;
  }

  toNumbers(): number[] {
    return this.values.map(Number);
  }
}

function describe(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (value instanceof ConfigObject) return 'config';
  if (value instanceof ConfigList) return 'list';
  if (value instanceof ConfigNumberList) return 'numberlist';
  if (typeof value === 'bigint') return `long ${value}`;
  return `${typeof value} ${String(value)}`;
}

function createValue(type: ConfigType, reader: DataReader, version: number): ConfigValue {
  switch (type) {
    case ConfigType.Object:
      return readObject(reader, version);
    case ConfigType.String:
      return reader.readUtf();
    case ConfigType.Integer:
      return reader.readInt();
    case ConfigType.Float:
      return reader.readFloat();
    case ConfigType.Boolean:
      return reader.readByte() !== 0;
    case ConfigType.Long:
      return reader.readLong();
    case ConfigType.Double:
      return reader.readDouble();
    case ConfigType.HugeLong:
      throw new Config2Error(
        'config2: the HugeLong type was removed; use SimpleLibrary 10.2.1 or earlier to read this file',
      );
    case ConfigType.List:
      return readList(reader, version);
    case ConfigType.Byte:
      return reader.readSignedByte();
    case ConfigType.Short:
      return reader.readShort();
    case ConfigType.NumberList:
      return readNumberList(reader);
    default:
      throw new Config2Error(`config2: unknown type index ${type}`);
  }
}

function readObject(reader: DataReader, version: number): ConfigObject {
  const config = new ConfigObject();
  if (version === 0) {
    // Version 0 wrote the key BEFORE the payload and used a different loop.
    for (;;) {
      const index = reader.readByte();
      if (index <= 0) break;
      const key = reader.readUtf();
      config.setValue(key, createValue(index as ConfigType, reader, version));
    }
    return config;
  }
  for (;;) {
    const index = reader.readByte();
    if (index <= 0) break;
    const value = createValue(index as ConfigType, reader, version);
    const key = reader.readUtf();
    config.setValue(key, value);
  }
  return config;
}

function readList(reader: DataReader, version: number): ConfigList {
  // Version 0 predates the One Type system: it always takes the heterogeneous path.
  const oneType = version === 0 ? 2 : reader.readByte();
  const list = new ConfigList();
  if (oneType === 0) return list; // empty list
  if (oneType === 1) {
    const count = reader.readInt();
    const index = reader.readByte() as ConfigType;
    for (let i = 0; i < count; i++) list.items.push(createValue(index, reader, version));
    return list;
  }
  for (;;) {
    const index = reader.readByte();
    if (index <= 0) break;
    if (version === 0) reader.readShort(); // the UTF-8 empty-string "name"
    list.items.push(createValue(index as ConfigType, reader, version));
  }
  return list;
}

function readNumberList(reader: DataReader): ConfigNumberList {
  const first = reader.readByte();
  const sizeClass = (first & 0xc0) >> 6;
  let size: number;
  switch (sizeClass) {
    case 0:
      size = first & 0x3f;
      break;
    case 1:
      size = ((first & 0x3f) << 8) | reader.readByte();
      break;
    case 2:
      size = ((first & 0x3f) << 24) | (reader.readByte() << 16) | (reader.readByte() << 8) | reader.readByte();
      break;
    default:
      size = reader.readInt() >>> 0;
      break;
  }
  const values: bigint[] = [];
  if (size === 0) return new ConfigNumberList(values);

  const digits = reader.readByte();
  if ((digits & 0x80) > 0) {
    for (let i = 0; i < size; i++) values.push(reader.readLong());
    return new ConfigNumberList(values);
  }
  const hasNeg = (digits & 0x40) > 0;
  const bitCount = digits & 0x3f;
  if (bitCount === 0) {
    for (let i = 0; i < size; i++) values.push(0n);
    return new ConfigNumberList(values);
  }

  let currentByte = 0;
  let left = 0;
  for (let i = 0; i < size; i++) {
    let isNeg = false;
    if (left < 1) {
      currentByte = reader.readByte();
      left = 8;
    }
    if (hasNeg) {
      isNeg = (currentByte & (1 << (left - 1))) > 0;
      left--;
    }
    let number = 0n;
    let nextLeft = bitCount;
    while (nextLeft > 0) {
      if (left < 1) {
        currentByte = reader.readByte();
        left = 8;
      }
      const bits = Math.min(nextLeft, left);
      const mask = (0xff >> (8 - bits)) << (left - bits);
      const transfer = (currentByte & mask) >> (left - bits);
      number |= BigInt(transfer) << BigInt(nextLeft - bits);
      nextLeft -= bits;
      left -= bits;
    }
    values.push(isNeg ? -number : number);
  }
  return new ConfigNumberList(values);
}

/**
 * Java `Config.load(InputStream)`: read the version short, reject `ConfigMulti`
 * (version 2) and anything newer than `CONFIG_VERSION` (1), then read the root
 * object.
 */
export function parseConfig2(bytes: Uint8Array, label = '<config2>'): ConfigObject {
  const reader = new DataReader(bytes, label);
  const version = reader.readShort();
  if (version === 2) {
    throw new Config2Error(`${label}: not a Config file (this is a ConfigMulti file)`);
  }
  if (version > 1) throw new Config2Error(`${label}: file is a newer version of format (${version})`);
  const config = readObject(reader, version);
  return config;
}

export function readConfig2Path(path: string): ConfigObject {
  return parseConfig2(readFileSync(path), path);
}

/** True when the first two bytes are a config2 version short this reader accepts. */
export function looksLikeConfig2(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const version = (bytes[0]! << 8) | bytes[1]!;
  return version === 0 || version === 1;
}

function jsonView(value: ConfigValue | undefined): unknown {
  if (value instanceof ConfigObject) return value.toJson();
  if (value instanceof ConfigList) return value.items.map(jsonView);
  if (value instanceof ConfigNumberList) return value.toNumbers();
  if (typeof value === 'bigint') return Number(value);
  return value ?? null;
}
