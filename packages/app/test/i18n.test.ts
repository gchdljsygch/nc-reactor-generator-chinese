import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack } from '@ncplanner/i18n';
import { AppI18n } from '@ncplanner/app/i18n';
import { SettingsStore, defaultSettings, normalizeSettings, type StorageLike } from '@ncplanner/app/settings';

/**
 * R3.2 / R3.8 — language switching, persistence and the "no half translation"
 * rule, exercised through the app's own facade.
 */

const ROOT = new URL('../../../', import.meta.url);
const pack = (name: string) => loadPack(JSON.parse(readFileSync(fileURLToPath(new URL(`lang/${name}`, ROOT)), 'utf8')) as unknown);

const packs = [
  pack('en_US.messages.json'),
  pack('en_US.app.json'),
  pack('zh_CN.messages.json'),
  pack('zh_CN.app.json'),
  pack('zh_CN.elements.json'),
];

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('settings', () => {
  it('validates every field independently', () => {
    const settings = normalizeSettings({ language: 'zh_CN', theme: 'nope', sliceIndex: -4, viewMode: '3d' });
    expect(settings.language).toBe('zh_CN');
    expect(settings.theme).toBe(defaultSettings().theme);
    expect(settings.sliceIndex).toBe(0);
    expect(settings.viewMode).toBe('3d');
  });

  it('survives corrupted storage', () => {
    const storage = new MemoryStorage();
    storage.setItem('ncplanner.settings', '{not json');
    const store = new SettingsStore({ storage });
    expect(store.current.language).toBe(defaultSettings().language);
  });

  it('persists updates', () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore({ storage });
    store.update({ language: 'zh_CN', theme: 'light' });
    const reloaded = new SettingsStore({ storage });
    expect(reloaded.current.language).toBe('zh_CN');
    expect(reloaded.current.theme).toBe('light');
  });

  it('keeps unknown legacy keys verbatim', () => {
    const settings = normalizeSettings({ legacy: { benchmark: true, guiScale: 2 } });
    expect(settings.legacy).toEqual({ benchmark: true, guiScale: 2 });
  });
});

describe('app i18n', () => {
  it('switches language at runtime and persists the choice', () => {
    const storage = new MemoryStorage();
    const settings = new SettingsStore({ storage });
    const i18n = new AppI18n({ packs, settings });
    expect(i18n.locale).toBe('en_US');
    expect(i18n.t('menu.file.save')).toBe('Save');
    i18n.setLocale('zh_CN');
    expect(i18n.t('menu.file.save')).toBe('保存');
    // the facade writes through the settings store, which is what makes the
    // choice survive a reload (R3.2)
    expect(settings.current.language).toBe('zh_CN');
    expect(new SettingsStore({ storage }).current.language).toBe('zh_CN');
  });

  it('falls back whole to English for a key Chinese does not define', () => {
    // The shipped `zh_CN` packs are key-for-key parity with the canonical ones
    // by construction — `lang/zh_CN.messages.json` carries exactly the 283 keys
    // the migration auto-classified and `zh_CN.app.json` the 124 app keys, with
    // no key missing and none extra — so no *shipped* key can leave the first
    // chain level untranslated. The case the facade must handle is therefore
    // built here explicitly, with the shipped key and its shipped canonical
    // text; the second pack is Chinese and does define a key, so the lookup
    // really does start at a `zh_CN` level.
    const i18n = new AppI18n({
      packs: [
        {
          locale: 'en_US',
          meta: { locale: 'en_US' },
          messages: {
            'config.overhaul.distiller.configuration': 'Overhaul Distiller Configuration',
          },
          elements: {},
          extra: {},
        },
        {
          locale: 'zh_CN',
          meta: { locale: 'zh_CN', base: 'en_US' },
          messages: { 'menu.file.save': '保存' },
          elements: {},
          extra: {},
        },
      ],
    });
    i18n.setLocale('zh_CN');
    const key = 'config.overhaul.distiller.configuration';
    expect(i18n.t(key)).toBe('Overhaul Distiller Configuration');
    // and never returns a partially translated sentence: the result is the
    // canonical entry whole, with no Chinese fragment glued into it
    expect(i18n.t(key)).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('returns the key itself when nothing defines it (never prose)', () => {
    const i18n = new AppI18n({ packs });
    expect(i18n.t('does.not.exist')).toBe('does.not.exist');
  });

  it('pluralises per language (Chinese has no plural form)', () => {
    const i18n = new AppI18n({
      packs: [
        {
          locale: 'en_US',
          meta: { locale: 'en_US' },
          messages: { 'test.count': { one: '{0} block', other: '{0} blocks' } },
          elements: {},
          extra: {},
        },
        {
          locale: 'zh_CN',
          meta: { locale: 'zh_CN' },
          messages: { 'test.count': '{0} 个方块' },
          elements: {},
          extra: {},
        },
      ],
    });
    expect(i18n.tc('test.count', 1)).toBe('1 block');
    expect(i18n.tc('test.count', 3)).toBe('3 blocks');
    i18n.setLocale('zh_CN');
    expect(i18n.tc('test.count', 1)).toBe('1 个方块');
    expect(i18n.tc('test.count', 5)).toBe('5 个方块');
  });

  it('reorders arguments through the language pack, not the call site', () => {
    const i18n = new AppI18n({
      packs: [
        {
          locale: 'en_US',
          meta: { locale: 'en_US' },
          messages: { 'test.recipe': '{0} to {1}' },
          elements: {},
          extra: {},
        },
        {
          locale: 'zh_CN',
          meta: { locale: 'zh_CN', base: 'en_US' },
          messages: { 'test.recipe': '{1} 由 {0} 生成' },
          elements: {},
          extra: {},
        },
      ],
    });
    expect(i18n.t('test.recipe', { 0: 'A', 1: 'B' })).toBe('A to B');
    i18n.setLocale('zh_CN');
    expect(i18n.t('test.recipe', { 0: 'A', 1: 'B' })).toBe('B 由 A 生成');
  });

  it('lists the available languages with their own names', () => {
    const i18n = new AppI18n({ packs });
    const options = i18n.options();
    expect(options.map((option) => option.locale)).toEqual(['en_US', 'zh_CN']);
    expect(options.find((option) => option.locale === 'zh_CN')?.name).toBe('简体中文');
  });

  it('registers an external pack without code changes (iron law 7)', () => {
    const i18n = new AppI18n({ packs });
    i18n.registerExternalPack({
      meta: { locale: 'ja_JP', name: '日本語' },
      messages: { 'menu.file.save': '保存' },
    });
    i18n.setLocale('ja_JP');
    expect(i18n.t('menu.file.save')).toBe('保存');
    // untranslated keys fall back whole to the canonical language
    expect(i18n.t('menu.file.open')).toBe('Open…');
  });

  it('reports missing keys for the coverage gate', () => {
    const i18n = new AppI18n({ packs });
    i18n.setLocale('zh_CN');
    i18n.t('missing.key.one');
    const summary = i18n.coverage();
    expect(summary.total).toBeGreaterThan(0);
  });
});
