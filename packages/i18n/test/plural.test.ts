import { describe, expect, it } from 'vitest';
import {
  LocaleManager,
  MessageBundle,
  MissingKeyReporter,
  loadPack,
  pluralCategory,
  hasPluralDistinction,
  type LanguagePack,
} from '@ncplanner/i18n';

/**
 * R1.2b — plurals and word order.
 *
 * Form mechanism (the documented choice): a plural message is **one key whose
 * value is an object of ICU plural categories**, e.g.
 *
 *     "stat.cells": { "one": "{0} fuel cell", "other": "{0} fuel cells" }
 *
 * The alternative (`key.one` / `key.other` as two separate keys) was rejected
 * because it cannot be resolved "whole": a lookup could find `key.one` at one
 * level and `key.other` at another, which is exactly the half-translation trap.
 */

const EN: LanguagePack = loadPack({
  meta: { locale: 'en_US', name: 'English' },
  messages: {
    'stat.cells': { one: '{0} fuel cell', other: '{0} fuel cells' },
    'stat.blocks.named': { one: '{n} block', other: '{count} blocks' },
    'stat.only.one': { one: '{0} lone cell' },
    'tooltip.recipe': '{input} to {output}',
    'tooltip.recipe.positional': '{0} to {1}',
    'stat.heatsinks': { one: '{0} heatsink', other: '{0} heatsinks' },
  },
});

const ZH_CN: LanguagePack = loadPack({
  meta: { locale: 'zh_CN', name: '简体中文' },
  messages: {
    // Chinese has no plural distinction: one form, used for every count.
    'stat.cells': '共 {0} 个燃料单元',
    'tooltip.recipe': '由 {input} 生成 {output}',
    'tooltip.recipe.positional': '由 {0} 生成 {1}',
    // A pack that nevertheless carries two forms must still render one form.
    'stat.blocks.named': { one: '{n} 个方块', other: '{n} 个方块' },
    // A single-form language tolerates an entry that only carries `one`.
    'stat.heatsinks.single': { one: '一台散热器' },
    'stat.heatsinks.count': { one: '{0} 台散热器' },
  },
});

// A locale *with* a plural distinction whose pack is incomplete: it can serve 1
// but not 5, which must fall back to the whole en_US entry.
const EN_GB: LanguagePack = loadPack({
  meta: { locale: 'en_GB', name: 'English (UK)' },
  messages: {
    'stat.heatsinks': { one: 'a single heatsink' },
  },
});

function bundleFor(locale: string, ...extra: LanguagePack[]) {
  const manager = new LocaleManager({ packs: [EN, ZH_CN, ...extra], initialLocale: locale });
  return { manager, messages: new MessageBundle(manager) };
}

describe('plural rules', () => {
  it('zh has a single form and no plural distinction', () => {
    expect(hasPluralDistinction('zh')).toBe(false);
    expect(hasPluralDistinction('zh_CN')).toBe(false);
    expect(pluralCategory('zh_CN', 1)).toBe('other');
    expect(pluralCategory('zh_CN', 5)).toBe('other');
  });

  it('en distinguishes one from other', () => {
    expect(hasPluralDistinction('en_US')).toBe(true);
    expect(pluralCategory('en_US', 1)).toBe('one');
    expect(pluralCategory('en_US', 0)).toBe('other');
    expect(pluralCategory('en_US', 5)).toBe('other');
  });
});

describe('plural()', () => {
  it('zh renders the same form for 1 and 3 (number changes, form does not)', () => {
    const { messages } = bundleFor('zh_CN');
    expect(messages.plural('stat.cells', 1)).toBe('共 1 个燃料单元');
    expect(messages.plural('stat.cells', 3)).toBe('共 3 个燃料单元');
    // Strip the number: the surrounding text must be identical.
    const form = (n: number) => messages.plural('stat.cells', n).replace(String(n), 'N');
    expect(form(1)).toBe(form(3));
    expect(form(99)).toBe(form(1));
  });

  it('en selects two different forms', () => {
    const { messages } = bundleFor('en_US');
    expect(messages.plural('stat.cells', 1)).toBe('1 fuel cell');
    expect(messages.plural('stat.cells', 2)).toBe('2 fuel cells');
    expect(messages.plural('stat.cells', 0)).toBe('0 fuel cells');
  });

  it('binds the count to {0}, {n} and {count}', () => {
    const { messages } = bundleFor('en_US');
    expect(messages.plural('stat.blocks.named', 1)).toBe('1 block');
    expect(messages.plural('stat.blocks.named', 4)).toBe('4 blocks');
  });

  it('zh uses its single form even when the pack carries two', () => {
    const { messages } = bundleFor('zh_CN');
    expect(messages.plural('stat.blocks.named', 1)).toBe('1 个方块');
    expect(messages.plural('stat.blocks.named', 4)).toBe('4 个方块');
    // ...and tolerates an entry that only carries `one`: it is used for every
    // count (the singular form), which is exactly how a language without plural
    // forms degrades.
    expect(messages.plural('stat.heatsinks.single', 5)).toBe('一台散热器');
    expect(messages.plural('stat.heatsinks.count', 5)).toBe('5 台散热器');
  });

  it('falls back whole when the active level cannot serve the count', () => {
    const { messages } = bundleFor('en_GB', EN_GB);
    expect(messages.plural('stat.heatsinks', 1)).toBe('a single heatsink');
    // en_GB has no `other`, so the en_US entry is used — whole, not glued onto
    // the en_GB `one` form.
    expect(messages.plural('stat.heatsinks', 5)).toBe('5 heatsinks');
    expect(messages.plural('stat.heatsinks', 5)).not.toContain('single');
  });

  it('returns the key when nothing defines it, and reports the miss', () => {
    const reporter = new MissingKeyReporter({ warn: false });
    const { manager } = bundleFor('zh_CN');
    const messages = new MessageBundle(manager, { reporter });
    expect(messages.plural('stat.nope', 2)).toBe('stat.nope');
    expect(reporter.summary()).toMatchObject({ total: 1, unique: 1, byKind: { plural: 1 } });
  });
});

describe('word order', () => {
  const args = { input: 'Uranium', output: 'Plutonium' };

  it('en is "A to B"', () => {
    expect(bundleFor('en_US').messages.tr('tooltip.recipe', args)).toBe('Uranium to Plutonium');
  });

  it('zh is "B 由 A 生成" — the arguments swap places', () => {
    const text = bundleFor('zh_CN').messages.tr('tooltip.recipe', args);
    expect(text).toBe('由 Uranium 生成 Plutonium');
    // The whole point: position of the input differs between the two languages.
    const en = bundleFor('en_US').messages.tr('tooltip.recipe', args);
    expect(en.indexOf('Uranium')).toBeLessThan(en.indexOf('Plutonium'));
    // In Chinese the connective comes first: no per-word substitution can do this.
    expect(text.startsWith('由')).toBe(true);
  });

  it('positional arguments reorder too', () => {
    expect(bundleFor('en_US').messages.tr('tooltip.recipe.positional', ['Uranium', 'Plutonium'])).toBe(
      'Uranium to Plutonium',
    );
    expect(bundleFor('zh_CN').messages.tr('tooltip.recipe.positional', ['Uranium', 'Plutonium'])).toBe(
      '由 Uranium 生成 Plutonium',
    );
  });
});
