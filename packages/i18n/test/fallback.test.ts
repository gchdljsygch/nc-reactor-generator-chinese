import { describe, expect, it } from 'vitest';
import {
  LocaleManager,
  MessageBundle,
  loadPack,
  type LanguagePack,
  type LocalePersistence,
} from '@ncplanner/i18n';

/**
 * R1.2a / R1.2d — the fallback chain, level by level.
 *
 * The chain is `zh_CN → zh → en_US → key`. Every level is asserted separately
 * because the interesting failures are off-by-one (never reaching `en_US`) and
 * "half translation" (mixing two levels inside one string).
 */

const EN_MESSAGES = {
  'only.en': 'English only',
  'all.levels': 'English (all levels)',
  'menu.add': 'Add {0}',
  'menu.add.named': 'Add {name}',
  'whole.sentence':
    'Delete the currently selected multiblock\nWARNING: This cannot be undone!',
  'tooltip.recipe': '{input} to {output}',
} as const;

const ZH_MESSAGES = {
  'only.zh': '仅语言级',
  'all.levels': '中文（语言级）',
} as const;

const ZH_CN_MESSAGES = {
  'only.zh_CN': '仅区域级',
  'all.levels': '中文（区域级）',
  'menu.add': '添加 {0}',
  'menu.add.named': '添加 {name}',
  // Deliberate poisoning: every word of `whole.sentence` exists as its own key,
  // exactly like the legacy substring table. A substring-based lookup would
  // return a mixed string; the bundle must return the whole en_US sentence.
  Delete: '删除',
  'the currently': '当前',
  selected: '选中的',
  multiblock: '多方块结构',
  WARNING: '警告',
  cannot: '不能',
  undone: '撤销',
} as const;

function buildPacks(): LanguagePack[] {
  return [
    loadPack({ meta: { locale: 'en_US', name: 'English' }, messages: EN_MESSAGES }),
    loadPack({ meta: { locale: 'zh', name: '中文' }, messages: ZH_MESSAGES }),
    loadPack({ meta: { locale: 'zh_CN', name: '简体中文' }, messages: ZH_CN_MESSAGES }),
  ];
}

function bundleFor(locale = 'zh_CN') {
  const manager = new LocaleManager({ packs: buildPacks(), initialLocale: locale });
  return { manager, messages: new MessageBundle(manager) };
}

describe('locale chain', () => {
  it('expands zh_CN to zh_CN → zh → en_US', () => {
    const manager = new LocaleManager({ packs: buildPacks(), initialLocale: 'zh_CN' });
    expect(manager.locale).toBe('zh_CN');
    expect(manager.chain()).toEqual(['zh_CN', 'zh', 'en_US']);
  });

  it('normalises locale tags from user input', () => {
    const manager = new LocaleManager({ packs: buildPacks(), initialLocale: 'zh_CN' });
    expect(manager.setLocale('zh-cn')).toBe('zh_CN');
    expect(manager.setLocale('EN_us')).toBe('en_US');
    expect(manager.chain()).toEqual(['en_US', 'en']);
  });

  it('falls back to the canonical locale for an unknown tag', () => {
    const manager = new LocaleManager({ packs: buildPacks(), initialLocale: 'not-a-locale' });
    expect(manager.locale).toBe('en_US');
    expect(manager.chain()).toEqual(['en_US', 'en']);
  });
});

describe('fallback chain, level by level', () => {
  it('level 1 — the region pack', () => {
    expect(bundleFor().messages.tr('only.zh_CN')).toBe('仅区域级');
  });

  it('level 2 — the bare language pack', () => {
    expect(bundleFor().messages.tr('only.zh')).toBe('仅语言级');
  });

  it('level 3 — the canonical pack', () => {
    expect(bundleFor().messages.tr('only.en')).toBe('English only');
  });

  it('level 4 — the key itself when nothing defines it', () => {
    expect(bundleFor().messages.tr('no.such.key')).toBe('no.such.key');
  });

  it('prefers the most specific level when all levels define a key', () => {
    expect(bundleFor().messages.tr('all.levels')).toBe('中文（区域级）');
    expect(bundleFor('zh').messages.tr('all.levels')).toBe('中文（语言级）');
    expect(bundleFor('en_US').messages.tr('all.levels')).toBe('English (all levels)');
  });

  it('does not fall back upwards when the active locale is the canonical one', () => {
    const { messages } = bundleFor('en_US');
    expect(messages.tr('only.zh')).toBe('only.zh');
    expect(messages.tr('only.zh_CN')).toBe('only.zh_CN');
    expect(messages.tr('only.en')).toBe('English only');
  });

  it('returns the whole en_US string, never a half-translated mix', () => {
    const { messages } = bundleFor('zh_CN');
    expect(messages.tr('whole.sentence')).toBe(EN_MESSAGES['whole.sentence']);
    // The poisoning above: every fragment of that sentence is translated, so a
    // substring implementation would produce CJK characters here.
    expect(/[\u4e00-\u9fff]/.test(messages.tr('whole.sentence'))).toBe(false);
  });

  it('formats placeholders from the pack that supplied the string', () => {
    expect(bundleFor('zh_CN').messages.tr('menu.add', ['燃料单元'])).toBe('添加 燃料单元');
    expect(bundleFor('en_US').messages.tr('menu.add', ['Fuel Cell'])).toBe('Add Fuel Cell');
    // A placeholder with no argument stays literal: never invent a value.
    expect(bundleFor('zh_CN').messages.tr('menu.add')).toBe('添加 {0}');
  });

  it('formats named placeholders as well as positional ones', () => {
    const args = { name: '燃料单元' };
    expect(bundleFor('zh_CN').messages.tr('menu.add.named', args)).toBe('添加 燃料单元');
    expect(bundleFor('en_US').messages.tr('menu.add.named', { name: 'Fuel Cell' })).toBe(
      'Add Fuel Cell',
    );
    // An unknown named placeholder is left verbatim rather than blanked out.
    expect(bundleFor('zh_CN').messages.tr('menu.add.named', { other: 'x' })).toBe('添加 {name}');
  });

  it('reorders two arguments per language', () => {
    const args = { input: 'Uranium', output: 'Plutonium' };
    expect(bundleFor('en_US').messages.tr('tooltip.recipe', args)).toBe('Uranium to Plutonium');
  });

  it('switches locale at runtime without rebuilding the bundle', () => {
    const { manager, messages } = bundleFor('zh_CN');
    expect(messages.tr('only.zh_CN')).toBe('仅区域级');
    manager.setLocale('en_US');
    expect(messages.tr('only.zh_CN')).toBe('only.zh_CN');
    // Back to `zh`: the region level is gone, the language level is active again.
    manager.setLocale('zh');
    expect(messages.tr('only.zh')).toBe('仅语言级');
    expect(messages.tr('only.zh_CN')).toBe('only.zh_CN');
  });
});

describe('listeners', () => {
  it('notifies subscribers with previous/locale/chain and unsubscribes', () => {
    const manager = new LocaleManager({ packs: buildPacks(), initialLocale: 'zh_CN' });
    const seen: string[] = [];
    const unsubscribe = manager.onChange((change) => {
      seen.push(`${change.previous}->${change.locale}:${change.chain.join(',')}`);
    });
    manager.setLocale('en_US');
    manager.setLocale('en_US'); // no-op, must not notify
    unsubscribe();
    manager.setLocale('zh');
    expect(seen).toEqual(['zh_CN->en_US:en_US,en']);
  });
});

describe('persistence hook', () => {
  function fakePersistence(initial: string | undefined) {
    let stored = initial;
    const writes: string[] = [];
    const persistence: LocalePersistence = {
      read: () => stored,
      write: (locale) => {
        stored = locale;
        writes.push(locale);
      },
    };
    return { persistence, writes, stored: () => stored };
  }

  it('reads the stored locale on construction', () => {
    const fake = fakePersistence('zh_CN');
    const manager = new LocaleManager({ packs: buildPacks(), persistence: fake.persistence });
    expect(manager.locale).toBe('zh_CN');
  });

  it('writes on change, and an explicit initial locale wins over storage', () => {
    const fake = fakePersistence('zh_CN');
    const manager = new LocaleManager({
      packs: buildPacks(),
      persistence: fake.persistence,
      initialLocale: 'en_US',
    });
    expect(manager.locale).toBe('en_US');
    expect(fake.writes).toEqual([]);
    manager.setLocale('zh_CN');
    expect(fake.writes).toEqual(['zh_CN']);
    expect(fake.stored()).toBe('zh_CN');
  });

  it('ignores an unparseable stored locale', () => {
    const fake = fakePersistence('../../etc/passwd');
    const manager = new LocaleManager({ packs: buildPacks(), persistence: fake.persistence });
    expect(manager.locale).toBe('en_US');
  });
});
