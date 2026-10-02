/**
 * Message lookup (R1.2b / R1.2d).
 *
 * The single most important property of this class: a returned string always
 * comes from **exactly one** pack entry. The fallback chain is walked per whole
 * entry, so a partly-translated result (half Chinese, half English — the failure
 * mode of the legacy `SimplifiedChineseLocalizer`) is structurally impossible
 * here: if the chain finds nothing, the caller gets the *key*, never a patched
 * sentence.
 *
 * Plural entries are resolved before formatting (see `format.ts`), and an entry
 * that cannot serve the requested count — e.g. an `en` entry that only defines
 * `one` — is treated as absent at that level so that the next level is used
 * whole.
 */

import {
  formatTemplate,
  selectPluralForm,
  toContext,
  type MessageArgs,
  type MessageValue,
  type PluralForms,
} from './format.js';
import type { LocaleSource } from './pack.js';
import type { MissingKeyFallback, MissingKeyReporter } from './missingKeyReporter.js';

export interface MessageBundleOptions {
  /** Shared reporter; when absent, misses are recorded nowhere. */
  reporter?: MissingKeyReporter;
}

/** Where a key was found: the pack level plus its raw (unformatted) entry. */
export interface MessageLookup {
  readonly locale: string;
  readonly value: MessageValue;
}

function fallbackFor(source: LocaleSource, resolved: string): MissingKeyFallback {
  if (resolved === source.locale) return 'self';
  return resolved === source.canonical ? 'canonical' : 'language';
}

export class MessageBundle {
  private readonly source: LocaleSource;
  private readonly reporter: MissingKeyReporter | undefined;

  constructor(source: LocaleSource, options: MessageBundleOptions = {}) {
    this.source = source;
    this.reporter = options.reporter;
  }

  /** First level of the chain that defines `key`, if any. */
  lookup(key: string): MessageLookup | undefined {
    for (const locale of this.source.chain()) {
      const value = this.source.pack(locale)?.messages[key];
      if (value !== undefined) return { locale, value };
    }
    return undefined;
  }

  has(key: string): boolean {
    return this.lookup(key) !== undefined;
  }

  /**
   * `tr('menu.add', { name })` → "添加 燃料单元".
   *
   * A key that cannot be resolved in any level is reported and returned as-is:
   * the key is a stable id, so the UI still shows something greppable instead of
   * a plausible-looking but wrong sentence.
   */
  tr(key: string, args?: MessageArgs): string {
    const hit = this.lookup(key);
    if (hit === undefined) {
      this.reporter?.report({ key, kind: 'message', locale: this.source.locale, fallback: 'key' });
      return key;
    }
    const template = typeof hit.value === 'string' ? hit.value : otherForm(hit.value);
    if (template === undefined) {
      this.reporter?.report({ key, kind: 'message', locale: this.source.locale, fallback: 'key' });
      return key;
    }
    this.reportCoverage(key, hit.locale, 'message');
    return formatTemplate(template, toContext(args));
  }

  /**
   * `plural('stat.cells', 3)` → "3 fuel cells" / "共 3 个燃料单元".
   *
   * Languages without a plural distinction (Chinese, Japanese, …) render their
   * single form for every count; English selects `one`/`other`.
   *
   * Argument convention: the count always occupies `{0}` and is also available as
   * `{n}` / `{count}`; extra positional arguments therefore start at `{1}`.
   */
  plural(key: string, n: number, args?: MessageArgs): string {
    for (const locale of this.source.chain()) {
      const value = this.source.pack(locale)?.messages[key];
      if (value === undefined) continue;
      const template =
        typeof value === 'string' ? value : selectPluralForm(value, locale, n);
      if (template === undefined) continue;
      this.reportCoverage(key, locale, 'plural');
      return formatTemplate(template, this.countContext(n, args));
    }
    this.reporter?.report({ key, kind: 'plural', locale: this.source.locale, fallback: 'key' });
    return key;
  }

  /**
   * Transition hook (mirrors `Messages.trOr` in `docs/refactoring-plan.md` §4.2)
   * for call sites that still hold a literal string: the pack wins when it has
   * the key, otherwise the caller's own text is used — never a concatenation of
   * the two.
   */
  trOr(key: string, fallback: string, args?: MessageArgs): string {
    const hit = this.lookup(key);
    if (hit === undefined) {
      // Still a coverage miss (no pack defines the key) even though the caller
      // supplied usable text, so it is reported; the caller's literal is used
      // whole, never glued to a partial translation.
      this.reporter?.report({ key, kind: 'message', locale: this.source.locale, fallback: 'key' });
      return formatTemplate(fallback, toContext(args));
    }
    const template = typeof hit.value === 'string' ? hit.value : otherForm(hit.value);
    if (template === undefined) return formatTemplate(fallback, toContext(args));
    this.reportCoverage(key, hit.locale, 'message');
    return formatTemplate(template, toContext(args));
  }

  /** See `plural()`: the count takes slot `{0}`, caller positional args follow. */
  private countContext(n: number, args?: MessageArgs) {
    const context = toContext(args, { n, count: n });
    return { named: context.named, positional: [n, ...context.positional] };
  }

  private reportCoverage(key: string, resolved: string, kind: 'message' | 'plural'): void {
    const fallback = fallbackFor(this.source, resolved);
    if (fallback === 'self') return;
    this.reporter?.report({ key, kind, locale: this.source.locale, resolvedLocale: resolved, fallback });
  }
}

function otherForm(forms: PluralForms): string | undefined {
  return forms.other ?? forms.one;
}
