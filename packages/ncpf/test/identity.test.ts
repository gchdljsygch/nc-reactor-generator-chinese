import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { identityKey } from '@ncplanner/ncpf';

/**
 * R1.3e — identity keys, checked against R0's authoritative element dump.
 *
 * R0 finding #4: the two-segment key `type|definition` is **not** injective — 29
 * keys mapped onto mutually conflicting display names. Adding the configuration
 * and the configuration type makes it unique. This test proves both halves: the
 * two-segment key collides, the four-segment key does not.
 */

const DUMP = fileURLToPath(new URL('../../../datasets/ncpf-elements.jsonl', import.meta.url));

interface DumpedElement {
  config: string;
  cfgType: string;
  src: string;
  type: string;
  def: string;
  identity: string;
  display: string;
  legacy: string[];
}

function loadDump(): DumpedElement[] {
  const lines = readFileSync(DUMP, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  const first = JSON.parse(lines[0]) as { __meta?: unknown };
  expect(first.__meta).toBeDefined();
  return lines.slice(1).map((l) => JSON.parse(l) as DumpedElement);
}

/** Keys whose entries disagree about the display name. */
function conflictingKeys(entries: DumpedElement[], keyOf: (e: DumpedElement) => string) {
  const byKey = new Map<string, Set<string>>();
  for (const e of entries) {
    const key = keyOf(e);
    const displays = byKey.get(key) ?? new Set<string>();
    displays.add(e.display);
    byKey.set(key, displays);
  }
  return [...byKey].filter(([, displays]) => displays.size > 1);
}

describe('element identity keys', () => {
  const entries = loadDump();

  it(`covers the ${entries.length} dumped elements`, () => {
    expect(entries.length).toBe(948);
  });

  it('shows that the two-segment key is not injective (R0 finding #4)', () => {
    const conflicts = conflictingKeys(entries, (e) => e.identity);
    // R0 measured 29; if this ever changes the four-segment scheme needs a re-think.
    expect(conflicts.length).toBe(29);
    expect(conflicts[0]?.[1].size).toBeGreaterThan(1);
    // eslint-disable-next-line no-console
    console.log(
      `two-segment key: ${conflicts.length} keys with conflicting display names, e.g. ` +
        conflicts
          .slice(0, 3)
          .map(([k, v]) => `${k} -> ${[...v].join(' / ')}`)
          .join(' | '),
    );
  });

  it('is injective with configuration + configuration type', () => {
    const four = conflictingKeys(entries, (e) =>
      identityKey(e.config, e.cfgType, e.type, e.def),
    );
    expect(four).toEqual([]);
  });

  it('produces the documented four-segment shape', () => {
    const sample = entries[0]!;
    expect(identityKey(sample.config, sample.cfgType, sample.type, sample.def)).toBe(
      `${sample.config}/${sample.cfgType}/${sample.type}|${sample.def}`,
    );
  });

  it('keeps at least one non-empty legacy name per element (import compatibility)', () => {
    const missing = entries.filter((e) => e.legacy.length === 0);
    expect(missing).toEqual([]);
  });
});
