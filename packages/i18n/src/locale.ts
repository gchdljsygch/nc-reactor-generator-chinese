/**
 * Locales and fallback chains (R1.2a).
 *
 * The rewrite has exactly one canonical language, `en_US`. Every other pack may
 * be incomplete, so a string is looked up level by level:
 *
 *     zh_CN → zh → en_US → the key itself
 *
 * Two rules matter and are enforced by the bundles, not by this module:
 *
 *  - the chain is walked per *string*: the first level that provides the whole
 *    entry wins, and nothing is merged across levels (no half translations);
 *  - the last level is the key itself, which is a stable id, not English prose.
 */

/** The canonical language: the root of every fallback chain. */
export const CANONICAL_LOCALE = 'en_US';

/** ISO-639 style language subtag (`zh`, `fil`, `sah`). */
const LANGUAGE_RE = /^[A-Za-z]{2,3}$/;
/** ISO-3166 alpha-2 region or UN M.49 numeric region. */
const REGION_RE = /^([A-Za-z]{2}|[0-9]{3})$/;

export interface LocaleParts {
  /** Lower-case language subtag, e.g. `zh`. */
  language: string;
  /** Upper-case region subtag, e.g. `CN`. Absent for a bare language. */
  region?: string;
}

/**
 * Split a locale tag into its language and region parts.
 *
 * Only the `language[_REGION]` subset is accepted (no script subtags yet); the
 * R1.2 packs are `en_US` / `zh_CN` / `zh`, and a script/encoding subtag would
 * need a decision about font selection that belongs to R3.9. Returning
 * `undefined` instead of guessing keeps an unknown tag from silently becoming a
 * different language.
 */
export function splitLocale(input: string): LocaleParts | undefined {
  const cleaned = input.trim().replace(/-/g, '_');
  if (cleaned === '') return undefined;
  const parts = cleaned.split('_');
  if (parts.length > 2) return undefined;
  const language = parts[0] ?? '';
  if (!LANGUAGE_RE.test(language)) return undefined;
  if (parts.length === 1) return { language: language.toLowerCase() };
  const region = parts[1] ?? '';
  if (!REGION_RE.test(region)) return undefined;
  return { language: language.toLowerCase(), region: region.toUpperCase() };
}

/** `zh-cn` / `ZH_cn` / `zh_CN` → `zh_CN`. Returns `undefined` when unparseable. */
export function normalizeLocale(input: string): string | undefined {
  const parts = splitLocale(input);
  if (parts === undefined) return undefined;
  return parts.region === undefined ? parts.language : `${parts.language}_${parts.region}`;
}

/** `zh_CN` → `zh`; `undefined` when the tag is unparseable. */
export function languageOf(locale: string): string | undefined {
  return splitLocale(locale)?.language;
}

/**
 * The level-by-level lookup order for `locale`.
 *
 * Examples (with the default canonical locale):
 *
 *     localeChain('zh_CN') === ['zh_CN', 'zh', 'en_US']
 *     localeChain('zh')    === ['zh', 'en_US']
 *     localeChain('en_GB') === ['en_GB', 'en', 'en_US']
 *     localeChain('???')   === ['en_US']          // unknown tags never guess
 */
export function localeChain(locale: string, canonical: string = CANONICAL_LOCALE): string[] {
  const canonicalLocale = normalizeLocale(canonical) ?? CANONICAL_LOCALE;
  const chain: string[] = [];
  const normalized = normalizeLocale(locale);
  if (normalized !== undefined) {
    chain.push(normalized);
    const language = languageOf(normalized);
    if (language !== undefined && language !== normalized) chain.push(language);
  }
  if (!chain.includes(canonicalLocale)) chain.push(canonicalLocale);
  return chain;
}
