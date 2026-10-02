/**
 * Language packs (R1.2e).
 *
 * A pack is a plain JSON document:
 *
 * ```jsonc
 * {
 *   "meta":      { "locale": "zh_CN", "name": "简体中文", "version": "1.0.0", "base": "en_US" },
 *   "messages":  { "menu.add": "添加 {0}", "stat.cells": { "one": "...", "other": "..." } },
 *   "elements":  { "NuclearCraft/Overhaul SFR Configuration/legacy_block|nuclearcraft:cell": "燃料单元" },
 *   "sources":   { "menu.add": "Add {0}" },          // audit only: English source per key
 *   "needsReview": [ { "source": "Power", "translation": "功率", "reason": "fragment" } ]
 * }
 * ```
 *
 * Adding a language must require **zero code** (R1.2e), so nothing about a pack
 * is compiled in: `loadPack()` accepts any JSON that follows the shape above and
 * `LocaleManager.registerPack()`/`loadPack()` make it available at runtime. The
 * repo ships the same shape under `lang/*.json`.
 *
 * `sources` and `needsReview` are audit metadata produced by the R1.2f migration
 * tool. They are preserved (and never interpreted at runtime) so that a
 * re-generated draft can be diffed and reviewed without a second file.
 */

import { isPluralForms, PLURAL_CATEGORIES, type MessageValue, type PluralForms } from './format.js';
import { normalizeLocale } from './locale.js';

export interface LanguagePackMeta {
  /** Normalised locale tag, e.g. `zh_CN`. Always present on a loaded pack. */
  readonly locale: string;
  readonly name?: string;
  readonly version?: string;
  /** The pack this one falls back to; informational, the chain is canonical. */
  readonly base?: string;
  readonly rtl?: boolean;
  readonly authors?: readonly string[];
  /** `seed` / `draft` / `complete` — how much review the pack has had. */
  readonly status?: string;
  readonly [key: string]: unknown;
}

/** One legacy entry a migration could not auto-classify. */
export interface ReviewEntry {
  readonly source: string;
  readonly translation: string;
  readonly reason?: string;
}

export interface LanguagePack {
  readonly locale: string;
  readonly meta: LanguagePackMeta;
  readonly messages: Readonly<Record<string, MessageValue>>;
  readonly elements: Readonly<Record<string, string>>;
  /** English source string per message key (audit metadata). */
  readonly sources?: Readonly<Record<string, string>>;
  /** Entries kept but not auto-classified (audit metadata). */
  readonly needsReview?: readonly ReviewEntry[];
  /** Top-level keys this version of the loader does not know about. */
  readonly extra: Readonly<Record<string, unknown>>;
}

/**
 * A locale-aware view of the loaded packs.
 *
 * `MessageBundle` / `DataNameBundle` depend on this interface rather than on
 * `LocaleManager`, which keeps them testable with a three-line fake and lets the
 * app swap in a different registry later.
 */
export interface LocaleSource {
  /** The locale the user selected (before the fallback chain). */
  readonly locale: string;
  /** The canonical locale, the last level of every chain. */
  readonly canonical: string;
  /** Lookup order for the current locale, e.g. `['zh_CN', 'zh', 'en_US']`. */
  chain(): readonly string[];
  /** The pack registered for `locale`, if any. */
  pack(locale: string): LanguagePack | undefined;
}

export class PackFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackFormatError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePluralForms(locale: string, key: string, value: Record<string, unknown>): PluralForms {
  const forms: PluralForms = {};
  for (const [category, text] of Object.entries(value)) {
    if (!(PLURAL_CATEGORIES as readonly string[]).includes(category)) {
      throw new PackFormatError(
        `pack "${locale}": message "${key}" has unknown plural category "${category}" ` +
          `(expected one of ${PLURAL_CATEGORIES.join(', ')})`,
      );
    }
    if (typeof text !== 'string') {
      throw new PackFormatError(
        `pack "${locale}": message "${key}.${category}" must be a string`,
      );
    }
    forms[category as keyof PluralForms] = text;
  }
  if (Object.keys(forms).length === 0) {
    throw new PackFormatError(`pack "${locale}": message "${key}" has no plural forms`);
  }
  return forms;
}

function parseMessages(locale: string, value: unknown): Record<string, MessageValue> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new PackFormatError(`pack "${locale}": "messages" must be an object`);
  const messages: Record<string, MessageValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      messages[key] = raw;
    } else if (isRecord(raw)) {
      messages[key] = parsePluralForms(locale, key, raw);
    } else {
      throw new PackFormatError(
        `pack "${locale}": message "${key}" must be a string or a plural-forms object`,
      );
    }
  }
  return messages;
}

function parseStringMap(locale: string, section: string, value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new PackFormatError(`pack "${locale}": "${section}" must be an object`);
  const map: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') {
      throw new PackFormatError(`pack "${locale}": "${section}.${key}" must be a string`);
    }
    map[key] = raw;
  }
  return map;
}

function parseNeedsReview(locale: string, value: unknown): ReviewEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new PackFormatError(`pack "${locale}": "needsReview" must be an array`);
  }
  return value.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new PackFormatError(`pack "${locale}": "needsReview[${index}]" must be an object`);
    }
    const source = raw['source'];
    const translation = raw['translation'];
    const reason = raw['reason'];
    if (typeof source !== 'string' || typeof translation !== 'string') {
      throw new PackFormatError(
        `pack "${locale}": "needsReview[${index}]" needs string "source" and "translation"`,
      );
    }
    return reason === undefined
      ? { source, translation }
      : { source, translation, reason: String(reason) };
  });
}

const KNOWN_SECTIONS = new Set(['meta', 'messages', 'elements', 'sources', 'needsReview', 'locale']);

/**
 * Validate and normalise a parsed pack document.
 *
 * Validation is strict about *shape* and silent about *content*: an unknown
 * message key is fine (packs are allowed to be ahead of the code), a missing
 * `locale` is not (it would silently disable the pack).
 */
export function loadPack(json: unknown): LanguagePack {
  if (!isRecord(json)) throw new PackFormatError('language pack must be a JSON object');
  const rawMeta = json['meta'];
  if (rawMeta !== undefined && !isRecord(rawMeta)) {
    throw new PackFormatError('language pack: "meta" must be an object');
  }
  const metaRecord: Record<string, unknown> = rawMeta ?? {};
  const rawLocale = metaRecord['locale'] ?? json['locale'];
  if (typeof rawLocale !== 'string') {
    throw new PackFormatError('language pack: "meta.locale" must be a string');
  }
  const locale = normalizeLocale(rawLocale);
  if (locale === undefined) {
    throw new PackFormatError(`language pack: "${rawLocale}" is not a language[_REGION] tag`);
  }
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(json)) {
    if (!KNOWN_SECTIONS.has(key)) extra[key] = value;
  }
  const sources = parseStringMap(locale, 'sources', json['sources']);
  const needsReview = parseNeedsReview(locale, json['needsReview']);
  const pack: LanguagePack = {
    locale,
    meta: { ...metaRecord, locale },
    messages: parseMessages(locale, json['messages']),
    elements: parseStringMap(locale, 'elements', json['elements']),
    extra,
    ...(json['sources'] === undefined ? {} : { sources }),
    ...(needsReview === undefined ? {} : { needsReview }),
  };
  return pack;
}

/** `JSON.parse` + {@link loadPack}, with the source named in the error text. */
export function parsePack(text: string, source = '<string>'): LanguagePack {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    throw new PackFormatError(`${source}: not valid JSON (${(error as Error).message})`);
  }
  try {
    return loadPack(json);
  } catch (error) {
    throw new PackFormatError(`${source}: ${(error as Error).message}`);
  }
}

/**
 * Merge two packs of the **same** locale.
 *
 * A language is allowed to be split across files (`zh_CN.messages.json` +
 * `zh_CN.elements.json`), and a pack may be re-registered at runtime. Merging is
 * per *entry*: a message value is always taken verbatim from exactly one pack, so
 * merging can never produce the half-translation this package exists to prevent.
 *
 * `sources` / `needsReview` (audit metadata) are replaced as a whole when the
 * override carries them, which keeps re-registering the same pack idempotent.
 * `messages` / `elements` are merged per key instead, so an override may carry
 * only the entries it changes.
 */
export function mergePacks(base: LanguagePack, override: LanguagePack): LanguagePack {
  if (base.locale !== override.locale) {
    throw new PackFormatError(
      `cannot merge packs for different locales (${base.locale} + ${override.locale})`,
    );
  }
  const sources = override.sources ?? base.sources;
  const needsReview = override.needsReview ?? base.needsReview;
  return {
    locale: base.locale,
    meta: { ...base.meta, ...override.meta, locale: base.locale },
    messages: { ...base.messages, ...override.messages },
    elements: { ...base.elements, ...override.elements },
    extra: { ...base.extra, ...override.extra },
    ...(sources === undefined ? {} : { sources }),
    ...(needsReview === undefined ? {} : { needsReview }),
  };
}
