/**
 * Sequential `config2` reading.
 *
 * A pre-NCPF save is **not** a single config2 document: it is a stream of them.
 * Java `LegacyNCPF11Reader.read` does
 *
 * ```java
 * Config header = Config.newConfig(); header.load(in);   // version short + object
 * Config config = Config.newConfig(); config.load(in);   // version short + object
 * for(i < header.getInt("count")) readMultiblock(in);    // version short + object, N times
 * ```
 *
 * (`LegacyNCPF11Reader.java:89-103`), so every object carries its own version
 * short. `config2.ts` exposes `parseConfig2`, which owns its `DataReader` and
 * therefore cannot be called twice over one byte array; it does not export the
 * per-type value reader either.
 *
 * This module therefore re-implements the *object/list/number-list layout* of
 * `config2.ts:417-554` on top of the exported {@link DataReader} (which already
 * carries the fiddly parts: big-endian primitives, Java's modified UTF-8, and
 * float/double decoding). It is a faithful transcription; if the two ever
 * diverge, `config2.ts` is authoritative. **Recommended shared-file change**
 * (reported rather than made, see the module header of `ncpf11.ts`): export
 * `readConfig2Object(reader, version)` — or a `Config2Stream` — from
 * `config2.ts` so this duplication can go away.
 */
import {
  Config2Error,
  ConfigList,
  ConfigNumberList,
  ConfigObject,
  ConfigType,
  DataReader,
  type ConfigValue,
} from '../config2.js';

/** Java `Config` over a stream of concatenated `Config.load` payloads. */
export class Config2Stream {
  private readonly reader: DataReader;

  constructor(
    bytes: Uint8Array,
    private readonly label = '<config2>',
  ) {
    this.reader = new DataReader(bytes, label);
  }

  get position(): number {
    return this.reader.position;
  }

  get remaining(): number {
    return this.reader.remaining;
  }

  /** Java `Config.load(InputStream)`: version short, then the root object. */
  readConfig(): ConfigObject {
    const version = this.reader.readShort();
    if (version === 2) {
      throw new Config2Error(`${this.label}: not a Config file (this is a ConfigMulti file)`);
    }
    if (version > 1) throw new Config2Error(`${this.label}: file is a newer version of format (${version})`);
    return readObject(this.reader, version);
  }
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
