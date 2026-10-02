import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LocaleManager,
  MessageBundle,
  PackFormatError,
  loadPack,
  parsePack,
  type LanguagePack,
} from '@ncplanner/i18n';

/**
 * R1.2e — language-pack loading, and the migration artifacts of R1.2f.
 *
 * "Adding a language must require zero code" is only true if adding a *file* is
 * enough, so the built-in packs under `lang/` are loaded here through the same
 * public API an external pack would use — there is no compiled-in list of
 * languages anywhere in the package.
 */

const ROOT = new URL('../../../', import.meta.url);
const LANG_DIR = fileURLToPath(new URL('lang', ROOT));

function readLang(file: string): LanguagePack {
  return parsePack(readFileSync(`${LANG_DIR}/${file}`, 'utf8'), `lang/${file}`);
}

const MESSAGES = readLang('zh_CN.messages.json');
const ELEMENTS = readLang('zh_CN.elements.json');
const CANONICAL = readLang('en_US.messages.json');

describe('built-in packs', () => {
  it('loads every lang/*.json through the public loader', () => {
    const files = readdirSync(LANG_DIR).filter((file) => file.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const pack = readLang(file);
      expect(pack.locale).toMatch(/^[a-z]{2,3}(_[A-Z0-9]{2,3})?$/);
      expect(Object.keys(pack.messages).length + Object.keys(pack.elements).length).toBeGreaterThan(0);
    }
  });
});

describe('loadPack validation', () => {
  it('normalises the locale tag', () => {
    expect(loadPack({ meta: { locale: 'zh-cn' }, messages: {} }).locale).toBe('zh_CN');
    expect(loadPack({ locale: 'EN_us', messages: {} }).locale).toBe('en_US');
  });

  it('rejects malformed documents', () => {
    expect(() => loadPack(null)).toThrow(PackFormatError);
    expect(() => loadPack({ messages: {} })).toThrow(/meta\.locale/);
    expect(() => loadPack({ meta: { locale: 'xx_yy_zz' } })).toThrow(/language\[_REGION\]/);
    expect(() => loadPack({ meta: { locale: 'en_US' }, messages: { 'a.b': 1 } })).toThrow(
      /must be a string or a plural-forms object/,
    );
    expect(() =>
      loadPack({ meta: { locale: 'en_US' }, messages: { 'a.b': { singular: 'x' } } }),
    ).toThrow(/unknown plural category/);
    expect(() => loadPack({ meta: { locale: 'en_US' }, elements: { k: 2 } })).toThrow(
      /must be a string/,
    );
    expect(() =>
      loadPack({ meta: { locale: 'en_US' }, needsReview: [{ source: 'x' }] }),
    ).toThrow(/needs string "source" and "translation"/);
    expect(() => parsePack('{oops', 'bad.json')).toThrow(/bad\.json: not valid JSON/);
  });

  it('keeps audit metadata and unknown sections', () => {
    const pack = loadPack({
      meta: { locale: 'en_US', status: 'seed' },
      messages: { 'a.b': 'B' },
      sources: { 'a.b': 'B' },
      needsReview: [{ source: 'Power', translation: '功率', reason: 'fragment' }],
      futureSection: { anything: true },
    });
    expect(pack.meta['status']).toBe('seed');
    expect(pack.sources).toEqual({ 'a.b': 'B' });
    expect(pack.needsReview).toEqual([{ source: 'Power', translation: '功率', reason: 'fragment' }]);
    expect(pack.extra).toEqual({ futureSection: { anything: true } });
  });
});

describe('adding a language requires zero code', () => {
  const EN = loadPack({
    meta: { locale: 'en_US', name: 'English' },
    messages: { 'menu.save': 'Save', 'menu.add': 'Add {0}' },
  });

  it('registers a runtime pack and switches to it', () => {
    const manager = new LocaleManager({ packs: [EN], initialLocale: 'en_US' });
    const messages = new MessageBundle(manager);
    expect(messages.tr('menu.save')).toBe('Save');

    // The whole "new language" workflow: hand the loader a JSON document.
    manager.loadPack({
      meta: { locale: 'fr_FR', name: 'Français' },
      messages: { 'menu.save': 'Enregistrer' },
    });
    manager.setLocale('fr_FR');
    expect(manager.availableLocales()).toEqual(['en_US', 'fr_FR']);
    expect(messages.tr('menu.save')).toBe('Enregistrer');
    // ...and the canonical pack still serves everything it covers, whole.
    expect(messages.tr('menu.add', ['Block'])).toBe('Add Block');
  });

  it('registers a pack from JSON text', () => {
    const manager = new LocaleManager({ packs: [EN], initialLocale: 'en_US' });
    const pack = manager.loadPackText(
      JSON.stringify({ meta: { locale: 'de_DE' }, messages: { 'menu.save': 'Speichern' } }),
      'de_DE.messages.json',
    );
    expect(pack.locale).toBe('de_DE');
    manager.setLocale('de_DE');
    expect(new MessageBundle(manager).tr('menu.save')).toBe('Speichern');
  });
});

describe('R1.2f migration artifacts', () => {
  it('accounts for every draft entry in the re-keyed pack', () => {
    const counts = MESSAGES.meta['counts'] as Record<string, number>;
    const messages = Object.keys(MESSAGES.messages);
    const needsReview = MESSAGES.needsReview ?? [];
    expect(counts['total']).toBe(messages.length + needsReview.length);
    expect(counts['autoClassified']).toBe(messages.length);
    expect(counts['needsReview']).toBe(needsReview.length);
    // 1,101 unique UI draft entries + 26 element entries (docs/r0/translation-migration.md).
    expect(counts['draftMessageEntries']).toBe(1101);
    expect(counts['total']).toBe(1101);
    expect(counts['elementEntries']).toBe(26);
  });

  it('keeps a source (English) string for every re-keyed message', () => {
    const sources = MESSAGES.sources ?? {};
    for (const key of Object.keys(MESSAGES.messages)) {
      expect(sources[key], `missing source for ${key}`).toBeTypeOf('string');
      expect(sources[key]!.length).toBeGreaterThan(0);
    }
    expect(Object.keys(sources)).toHaveLength(Object.keys(MESSAGES.messages).length);
  });

  it('ships an en_US pack with exactly the same key set (coverage gate seed)', () => {
    expect(Object.keys(CANONICAL.messages).sort()).toEqual(Object.keys(MESSAGES.messages).sort());
    for (const [key, value] of Object.entries(CANONICAL.messages)) {
      expect(typeof value, `en_US ${key} must be a plain string in the seed pack`).toBe('string');
    }
  });

  it('ships element names keyed by identity, with no whitespace artifacts', () => {
    const keys = Object.keys(ELEMENTS.elements);
    // R5.1 completed the pack: the R0 migration covered 26 of the 732 unique identity
    // keys the dataset defines; the rest were translated and merged in
    // (`tools/ts/elements-pack.mjs`). The number is pinned so a regression that drops
    // entries is visible, and it is asserted against the dataset below rather than
    // being a magic constant on its own.
    expect(keys).toHaveLength(732);
    // Derive the expected count from the dataset itself so the constant above cannot
    // drift silently: every unique identity key the dataset defines must be covered.
    const datasetKeys = new Set(
      readFileSync(fileURLToPath(new URL('../../../datasets/ncpf-elements.jsonl', import.meta.url)), 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { __meta?: unknown; identity?: string; config?: string; cfgType?: string })
        .filter((row) => row.__meta === undefined)
        .map((row) => `${row.config}/${row.cfgType}/${row.identity}`),
    );
    const missing = [...datasetKeys].filter((key) => ELEMENTS.elements[key] === undefined);
    expect(missing, 'dataset identity keys with no translation').toEqual([]);

    for (const key of keys) {
      const value = ELEMENTS.elements[key]!;
      expect(value).toBe(value.trim());
      expect(/\//.test(key)).toBe(true);
    }
  });

  it('never half-translates through the migrated packs', () => {
    const manager = new LocaleManager({
      packs: [CANONICAL, MESSAGES, ELEMENTS],
      initialLocale: 'zh_CN',
    });
    const messages = new MessageBundle(manager);
    // A key that exists only in the canonical seed pack comes back untouched.
    const key = 'i18n.audit.this.key.does.not.exist';
    expect(messages.tr(key)).toBe(key);
    // Every migrated message resolves to its own draft translation.
    for (const [messageKey, value] of Object.entries(MESSAGES.messages)) {
      if (typeof value !== 'string') continue;
      expect(messages.tr(messageKey)).toBe(value);
    }
  });
});
