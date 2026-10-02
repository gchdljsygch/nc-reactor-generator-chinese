import { describe, expect, it } from 'vitest';
import type { NCPFElement } from '@ncplanner/ncpf';
import {
  DataNameBundle,
  LocaleManager,
  MessageBundle,
  MissingKeyReporter,
  dataNameKey,
  loadPack,
} from '@ncplanner/i18n';

/**
 * R1.2d — missing-key reporting.
 *
 * Two acceptance points from `docs/rewrite-plan-r1-r5.md` §3.3:
 *
 *  - a missing key falls back to the **whole** canonical string (or the key), and
 *  - the reporter aggregates misses for the CI gate.
 */

const EN = loadPack({
  meta: { locale: 'en_US', name: 'English' },
  messages: {
    'dialog.delete':
      'Delete the currently selected multiblock\nWARNING: This cannot be undone!',
    'menu.add': 'Add {0}',
  },
  elements: {
    'NuclearCraft/Overhaul SFR Configuration/legacy_block|nuclearcraft:solid_fission_cell':
      'Fuel Cell',
  },
});

const ZH_CN = loadPack({
  meta: { locale: 'zh_CN', name: '简体中文' },
  messages: {
    // Fragments only: a substring implementation would half-translate
    // `dialog.delete` with these; the bundle must not.
    Delete: '删除',
    WARNING: '警告',
    'cannot be undone': '无法撤销',
  },
  elements: {},
});

function makeElements() {
  const manager = new LocaleManager({ packs: [EN, ZH_CN], initialLocale: 'zh_CN' });
  const reporter = new MissingKeyReporter({ warn: false });
  const messages = new MessageBundle(manager, { reporter });
  const dataNames = new DataNameBundle(manager, { reporter });
  return { manager, reporter, messages, dataNames };
}

const cellElement = {
  definition: { type: 'legacy_block', identity: 'nuclearcraft:solid_fission_cell' },
  canonicalName: 'Fuel Cell',
} as unknown as NCPFElement;

describe('missing message keys', () => {
  it('returns the whole en_US string, never a half translation', () => {
    const { messages, reporter } = makeElements();
    const text = messages.tr('dialog.delete');
    expect(text).toBe(EN.messages['dialog.delete']);
    expect(/[\u4e00-\u9fff]/.test(text)).toBe(false);
    expect(reporter.summary()).toMatchObject({
      total: 1,
      unique: 1,
      byKind: { message: 1 },
      byFallback: { canonical: 1 },
    });
  });

  it('returns the key itself when no level defines it', () => {
    const { messages, reporter } = makeElements();
    expect(messages.tr('error.unknown.thing')).toBe('error.unknown.thing');
    expect(reporter.summary()).toMatchObject({ byFallback: { key: 1 } });
  });

  it('reports nothing when the active locale serves the key, and passes a literal through trOr', () => {
    const { manager, reporter } = makeElements();
    manager.registerPack(
      loadPack({ meta: { locale: 'zh_CN' }, messages: { 'local.only': '本地译文' } }),
    );
    const messages = new MessageBundle(manager, { reporter });
    expect(messages.tr('local.only')).toBe('本地译文');
    expect(reporter.summary().total).toBe(0);
    expect(messages.trOr('nope', 'literal text')).toBe('literal text');
    expect(reporter.summary()).toMatchObject({ total: 1, byFallback: { key: 1 } });
  });
});

describe('aggregation', () => {
  it('counts lookups, unique keys, kinds, fallbacks and locales', () => {
    const { messages, reporter } = makeElements();
    messages.tr('dialog.delete'); // canonical
    messages.tr('dialog.delete'); // canonical (again)
    messages.trOr('missing.one', 'x'); // key
    const summary = reporter.summary();
    expect(summary.total).toBe(3);
    expect(summary.unique).toBe(2);
    expect(summary.byKind).toMatchObject({ message: 3, plural: 0, element: 0 });
    expect(summary.byFallback).toMatchObject({ canonical: 2, key: 1 });
    expect(summary.byLocale).toEqual({ zh_CN: 3 });
    expect(summary.keys).toEqual(['dialog.delete', 'missing.one']);
    expect(reporter.keys()).toEqual(['dialog.delete', 'missing.one']);
    expect(reporter.format()).toContain('3 lookups, 2 unique');
  });

  it('counts element misses separately', () => {
    const { dataNames, reporter } = makeElements();
    const name = dataNames.name('NuclearCraft', 'Overhaul SFR Configuration', cellElement);
    // The zh_CN elements table is empty, so the en_US name is used whole.
    expect(name).toBe('Fuel Cell');
    expect(reporter.summary()).toMatchObject({
      total: 1,
      byKind: { element: 1 },
      byFallback: { canonical: 1 },
    });
  });

  it('falls back to the canonical name for an element no pack defines', () => {
    const { dataNames, reporter } = makeElements();
    const key = dataNameKey('NuclearCraft', 'Overhaul SFR Configuration', cellElement);
    expect(dataNames.nameOr(`${key}/nope`, 'Some Block')).toBe('Some Block');
    expect(reporter.summary().byFallback).toMatchObject({ 'canonical-name': 1 });
  });

  it('resets', () => {
    const { messages, reporter } = makeElements();
    messages.tr('dialog.delete');
    reporter.reset();
    expect(reporter.summary().total).toBe(0);
    expect(reporter.keys()).toEqual([]);
    expect(reporter.format()).toBe('[i18n] no missing keys');
  });
});

describe('dev-mode warnings', () => {
  it('warns once per kind:key by default', () => {
    const manager = new LocaleManager({ packs: [EN, ZH_CN], initialLocale: 'zh_CN' });
    const warnings: string[] = [];
    const reporter = new MissingKeyReporter({ logger: (m) => warnings.push(m) });
    const messages = new MessageBundle(manager, { reporter });
    messages.tr('dialog.delete');
    messages.tr('dialog.delete');
    messages.tr('error.other');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('message key "dialog.delete"');
    expect(warnings[0]).toContain('found in en_US');
    expect(warnings[1]).toContain('fell back to key');
  });

  it('can be disabled entirely', () => {
    const manager = new LocaleManager({ packs: [EN, ZH_CN], initialLocale: 'zh_CN' });
    const warnings: string[] = [];
    const reporter = new MissingKeyReporter({ enabled: false, logger: (m) => warnings.push(m) });
    const messages = new MessageBundle(manager, { reporter });
    messages.tr('dialog.delete');
    expect(warnings).toEqual([]);
    expect(reporter.summary().total).toBe(0);
  });
});
