import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { elementIdentityKey, identityKey, makeElement } from '@ncplanner/ncpf';
import {
  DataNameBundle,
  LocaleManager,
  MissingKeyReporter,
  dataNameKey,
  dataNameKeyFor,
  loadPack,
  parsePack,
} from '@ncplanner/i18n';

/**
 * R1.2c — data-name identity keys, over **all 948 elements** of the authoritative
 * dump (`datasets/ncpf-elements.jsonl`, produced by `ElementDump.java`).
 *
 * R0 finding #4: the rewrite plan originally proposed `type|definition` as the
 * `DataNameBundle` key. Measured, that key is not injective — 29 keys carried
 * *conflicting* display names. Adding `<config>/<cfgType>/` removes every
 * conflict. This file asserts both halves: the four-segment key is clean, and the
 * two-segment key would not be.
 */

const ROOT = new URL('../../../', import.meta.url);
const ELEMENTS_PATH = fileURLToPath(new URL('datasets/ncpf-elements.jsonl', ROOT));
const MESSAGES_PATH = fileURLToPath(new URL('lang/zh_CN.messages.json', ROOT));
const ELEMENTS_PACK_PATH = fileURLToPath(new URL('lang/zh_CN.elements.json', ROOT));

interface ElementRow {
  config: string;
  cfgType: string;
  src: string;
  type: string;
  def: string;
  identity: string;
  display: string;
  legacy: string[];
}

const ROWS: ElementRow[] = readFileSync(ELEMENTS_PATH, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as ElementRow | { __meta: unknown })
  .filter((row): row is ElementRow => !('__meta' in row));

/** key → set of display names that key maps onto. */
function groupByKey(rows: readonly ElementRow[], keyOf: (row: ElementRow) => string) {
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = keyOf(row);
    const names = groups.get(key) ?? new Set<string>();
    names.add(row.display);
    groups.set(key, names);
  }
  return groups;
}

const conflicting = (groups: Map<string, Set<string>>) =>
  [...groups.entries()].filter(([, names]) => names.size > 1);

describe('the authoritative element dump', () => {
  it('contains 948 elements (R0 baseline)', () => {
    expect(ROWS).toHaveLength(948);
    expect(ROWS.every((row) => row.identity === `${row.type}|${row.def}`)).toBe(true);
  });

  it('is reproduced exactly by identityKey(config, cfgType, type, definition)', () => {
    for (const row of ROWS) {
      expect(identityKey(row.config, row.cfgType, row.type, row.def)).toBe(
        `${row.config}/${row.cfgType}/${row.identity}`,
      );
    }
  });
});

describe('four-segment identity keys (R0 finding #4)', () => {
  const four = groupByKey(ROWS, (row) => identityKey(row.config, row.cfgType, row.type, row.def));
  const two = groupByKey(ROWS, (row) => `${row.type}|${row.def}`);

  it('has 732 keys, none of which maps onto conflicting display names', () => {
    expect(four.size).toBe(732);
    expect(conflicting(four)).toEqual([]);
  });

  it('collapses the 216 duplicate rows onto identical display names', () => {
    // These are the same element appearing in several element lists (e.g. global
    // elements and configuration elements); identical names make merging safe.
    expect(ROWS.length - four.size).toBe(216);
  });

  it('proves the scheme is necessary: a bare `type|definition` WOULD collide', () => {
    expect(two.size).toBe(660);
    const collisions = conflicting(two);
    expect(collisions).toHaveLength(29);
    // The canonical example from docs/r0/findings.md §4.
    const americium = collisions.find(([key]) => key === 'legacy_item|nuclearcraft:fuel_americium:2');
    expect(americium).toBeDefined();
    expect([...americium![1]].sort()).toEqual(['HEA-242', 'LEA-242 Nitride']);
  });
});

describe('DataNameBundle', () => {
  const manager = new LocaleManager({
    packs: [
      parsePack(readFileSync(MESSAGES_PATH, 'utf8'), 'lang/zh_CN.messages.json'),
      loadPack({
        meta: { locale: 'en_US', name: 'English' },
        messages: {},
        elements: {},
      }),
      parsePack(
        readFileSync(ELEMENTS_PACK_PATH, 'utf8'),
        'lang/zh_CN.elements.json',
      ),
    ],
    initialLocale: 'zh_CN',
  });

  it('builds the four-segment key for a real NCPFElement', () => {
    const element = makeElement({ type: 'legacy_block', name: 'nuclearcraft:solid_fission_cell' });
    expect(dataNameKey('NuclearCraft', 'Overhaul SFR Configuration', element)).toBe(
      'NuclearCraft/Overhaul SFR Configuration/legacy_block|nuclearcraft:solid_fission_cell',
    );
    // `elementIdentityKey` (via dataNameKey) and the raw helper agree.
    expect(dataNameKey('NuclearCraft', 'Overhaul SFR Configuration', element)).toBe(
      elementIdentityKey('NuclearCraft', 'Overhaul SFR Configuration', element),
    );
  });

  it('looks a localised name up by identity and falls back to the canonical name', () => {
    const reporter = new MissingKeyReporter({ warn: false });
    const dataNames = new DataNameBundle(manager, { reporter });
    const element = makeElement({ type: 'legacy_block', name: 'nuclearcraft:solid_fission_cell' });
    expect(dataNames.name('NuclearCraft', 'Overhaul SFR Configuration', element)).toBe('燃料单元');
    expect(
      dataNames.name('NuclearCraft', 'Overhaul SFR Configuration', makeElement({
        type: 'legacy_block',
        name: 'nuclearcraft:not_a_real_block',
      })),
    ).toBe('nuclearcraft:not_a_real_block');
    expect(reporter.summary()).toMatchObject({
      byKind: { element: 1 },
      byFallback: { 'canonical-name': 1 },
    });
  });

  it('translates every one of the 948 elements, with no half names and no orphans', () => {
    const elementPack = manager.pack('zh_CN')!;
    const translated = Object.keys(elementPack.elements);
    expect(translated.length).toBeGreaterThan(0);

    // Every dataset row must resolve to its translation. A row that fell back would
    // mean a missing key; a row that resolved to something other than the pack value
    // would mean the identity key derivation disagreed between writer and reader.
    const keysInDataset = new Set<string>();
    for (const row of ROWS) {
      const key = dataNameKeyFor(row.config, row.cfgType, row.type, row.def);
      keysInDataset.add(key);
      const name = new DataNameBundle(manager).nameOr(key, row.display);
      expect(elementPack.elements[key], `no translation for ${key}`).toBeDefined();
      expect(name, key).toBe(elementPack.elements[key]);
    }
    // And the pack must not carry keys the dataset never asks for: an orphan would
    // be dead weight (or a key-format mismatch that hides a real miss elsewhere).
    expect(translated.filter((key) => !keysInDataset.has(key))).toEqual([]);
    // 948 rows collapse onto 732 unique keys (216 rows are exact duplicates).
    expect(keysInDataset.size).toBe(732);
    expect(translated.every((key) => ROWS.some((row) => dataNameKeyFor(
      row.config,
      row.cfgType,
      row.type,
      row.def,
    ) === key))).toBe(true);
  });

  it('aggregates a missing element name per identity key', () => {
    const reporter = new MissingKeyReporter({ warn: false });
    const dataNames = new DataNameBundle(manager, { reporter });
    for (const row of ROWS) {
      dataNames.nameOr(dataNameKeyFor(row.config, row.cfgType, row.type, row.def), row.display);
    }
    const summary = reporter.summary();
    // R5.1 completed the element pack: every identity key the dataset defines now has
    // a translation, so a row resolved by the active locale is never a miss. The R0
    // baseline this test used to pin (948 rows - 26 migrated = 922 misses, on 706
    // unique keys) is now zero, which is the stronger claim and the one worth keeping:
    // a regression that dropped translations would show up here immediately.
    expect(summary.total, `untranslated rows out of ${ROWS.length}`).toBe(0);
    expect(summary.unique, 'untranslated identity keys').toBe(0);
  });
});
