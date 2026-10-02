/**
 * The ICU subset used by the rewrite (R1.2b).
 *
 * Two features are implemented, on purpose and by hand (no `intl-messageformat`
 * or similar dependency):
 *
 *  1. placeholders — `{0}` (positional) and `{name}` (named), substituted at the
 *     *text construction site*, which is what removes the need for the legacy
 *     render-time substring table (see `docs/refactoring-plan.md` §2 根因 1/2);
 *  2. plural forms — a message is either a plain string (languages without a
 *     plural distinction, e.g. Chinese: the single form is used for every
 *     count) or an object of ICU plural categories (`{"one": ..., "other": ...}`).
 *
 * Scope of the plural rules: only `one` / `other` are *selected by rule*, and
 * languages whose CLDR rules have a single form (`zh`, `ja`, `ko`, …) always
 * select that single form. Categories such as `few` / `many` (Polish, Russian,
 * Arabic, …) can be carried in a pack and are preserved, but they are not
 * auto-selected yet — that needs the full CLDR rule set and a locale the
 * rewrite does not ship. This limitation is documented in `docs/r1/r1.2-i18n.md`.
 */

export type MessageArgs = Readonly<Record<string, string | number>> | readonly (string | number)[];

export interface FormatContext {
  readonly named: Readonly<Record<string, string | number>>;
  readonly positional: readonly (string | number)[];
}

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export type PluralForms = Partial<Record<PluralCategory, string>>;

export type MessageValue = string | PluralForms;

export const PLURAL_CATEGORIES: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * Languages whose CLDR plural rules only ever produce `other`.
 *
 * The list is deliberately explicit: if a language is not here, `plural()`
 * selects `one`/`other` by the English rule, which is correct for the languages
 * the rewrite ships and errs on the side of *showing* a plural form rather than
 * silently degrading to one.
 */
const SINGLE_FORM_LANGUAGES: ReadonlySet<string> = new Set([
  'zh',
  'ja',
  'ko',
  'th',
  'vi',
  'id',
  'ms',
  'my',
  'km',
  'lo',
  'yo',
  'ig',
  'ii',
  'bo',
  'dz',
  'jv',
  'su',
  'sah',
  'to',
  'na',
  'tpi',
  'ug',
]);

const PLACEHOLDER_RE = /\{([A-Za-z0-9_][A-Za-z0-9_.-]*)\}/g;

/** True when the pack value carries plural categories instead of one string. */
export function isPluralForms(value: MessageValue): value is PluralForms {
  return typeof value === 'object' && value !== null;
}

/** True when the language makes a plural distinction that `plural()` acts on. */
export function hasPluralDistinction(locale: string): boolean {
  const language = locale.trim().toLowerCase().split(/[_-]/)[0] ?? '';
  return !SINGLE_FORM_LANGUAGES.has(language);
}

/**
 * The plural category for `n` in `locale`.
 *
 * Single-form languages always report `other`; every other language uses the
 * English `one`/`other` split. See the module comment for why richer CLDR
 * categories are out of scope.
 */
export function pluralCategory(locale: string, n: number): PluralCategory {
  if (!hasPluralDistinction(locale)) return 'other';
  return n === 1 ? 'one' : 'other';
}

/**
 * Pick the form to render, or `undefined` when this entry cannot serve `n`.
 *
 * Returning `undefined` is what makes "whole-string fallback" work for plurals:
 * an `en` pack that only defines `one` cannot render 3 without inventing text,
 * so the caller moves on to the next locale instead of mixing forms.
 */
export function selectPluralForm(
  forms: PluralForms,
  locale: string,
  n: number,
): string | undefined {
  const requested = pluralCategory(locale, n);
  const direct = forms[requested];
  if (direct !== undefined) return direct;
  if (!hasPluralDistinction(locale)) {
    // A single-form language has no mandated category, so accept whichever form
    // the translator wrote; `other` first because that is what the ICU data
    // generator emits for such languages.
    return forms.other ?? forms.one ?? firstForm(forms);
  }
  return forms.other;
}

function firstForm(forms: PluralForms): string | undefined {
  for (const category of PLURAL_CATEGORIES) {
    const value = forms[category];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Normalise the two argument shapes into one lookup context. */
export function toContext(
  args?: MessageArgs,
  extraNamed?: Readonly<Record<string, string | number>>,
): FormatContext {
  const named: Record<string, string | number> = { ...(extraNamed ?? {}) };
  const positional: (string | number)[] = [];
  if (Array.isArray(args)) {
    positional.push(...(args as readonly (string | number)[]));
  } else if (args !== undefined) {
    Object.assign(named, args as Readonly<Record<string, string | number>>);
  }
  return { named, positional };
}

/**
 * Substitute `{0}` / `{name}` placeholders.
 *
 * An unknown placeholder is left verbatim (`{missing}`): inventing a value (or
 * dropping the braces) would hide a programming error behind plausible text,
 * and the audit tooling can grep for the literal braces.
 */
export function formatTemplate(template: string, context: FormatContext): string {
  return template.replace(PLACEHOLDER_RE, (match, token: string) => {
    if (/^[0-9]+$/.test(token)) {
      const index = Number(token);
      const value = context.positional[index];
      return value === undefined ? match : String(value);
    }
    const value = context.named[token];
    return value === undefined ? match : String(value);
  });
}

/** Convenience wrapper: format with `MessageArgs` (+ optional extra named args). */
export function formatMessage(
  template: string,
  args?: MessageArgs,
  extraNamed?: Readonly<Record<string, string | number>>,
): string {
  return formatTemplate(template, toContext(args, extraNamed));
}
