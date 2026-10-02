/**
 * Current locale, fallback chain, listeners and pack registry (R1.2a / R1.2e).
 *
 * The manager owns *state* only: which locale is active, which packs exist, who
 * wants to know about a change. Text resolution lives in `MessageBundle` /
 * `DataNameBundle`, which read the state through the `LocaleSource` interface —
 * that keeps a bundle usable with a tiny fake in tests and keeps the fallback
 * policy in exactly one implementation.
 *
 * Persistence is a plain hook, deliberately not `settings.dat`: this package has
 * no IO, and R2.11 owns the `config2` migration. The app passes something like
 * `{ read: () => settings.language, write: (l) => { settings.language = l } }`.
 */

import { CANONICAL_LOCALE, localeChain, normalizeLocale } from './locale.js';
import {
  loadPack as loadLanguagePack,
  mergePacks,
  parsePack,
  type LanguagePack,
} from './pack.js';

export interface LocalePersistence {
  /** Previously stored locale, or `null`/`undefined` when nothing was stored. */
  read(): string | null | undefined;
  /** Store the newly selected locale. */
  write(locale: string): void;
}

export interface LocaleChange {
  readonly previous: string;
  readonly locale: string;
  readonly chain: readonly string[];
}

export type LocaleListener = (change: LocaleChange) => void;

export interface LocaleManagerOptions {
  /** Overrides `en_US` (only useful for tests and forks). */
  canonical?: string;
  /** Explicit initial locale; wins over `persistence.read()`. */
  initialLocale?: string;
  persistence?: LocalePersistence;
  packs?: readonly LanguagePack[];
}

export class LocaleManager {
  private readonly canonicalLocale: string;
  private readonly packsByLocale = new Map<string, LanguagePack>();
  private readonly listeners = new Set<LocaleListener>();
  private readonly persistenceHook: LocalePersistence | undefined;
  private current: string;
  /** Memoised `chain()`: every `tr()` call reads it, so avoid re-allocating. */
  private cachedChain: readonly string[];

  constructor(options: LocaleManagerOptions = {}) {
    this.canonicalLocale = normalizeLocale(options.canonical ?? CANONICAL_LOCALE) ?? CANONICAL_LOCALE;
    for (const pack of options.packs ?? []) this.registerPack(pack);
    this.persistenceHook = options.persistence;
    // An unparseable or empty stored value must not silently pick a random
    // locale: `resolve()` maps it onto the canonical one.
    const stored = options.initialLocale ?? options.persistence?.read();
    this.current = this.resolve(stored);
    this.cachedChain = localeChain(this.current, this.canonicalLocale);
  }

  /** The selected locale, e.g. `zh_CN`. */
  get locale(): string {
    return this.current;
  }

  /** The last level of every fallback chain, e.g. `en_US`. */
  get canonical(): string {
    return this.canonicalLocale;
  }

  get persistence(): LocalePersistence | undefined {
    return this.persistenceHook;
  }

  /** Normalise a locale tag, falling back to the canonical locale. */
  resolve(input: string | null | undefined): string {
    if (input === null || input === undefined) return this.canonicalLocale;
    return normalizeLocale(input) ?? this.canonicalLocale;
  }

  /** `['zh_CN', 'zh', 'en_US']` for the current locale. */
  chain(): readonly string[] {
    return this.cachedChain;
  }

  /**
   * Switch locale: persists it, then notifies listeners.
   *
   * Setting the locale that is already active is a no-op (no write, no event) so
   * that a UI which re-applies a setting on every render cannot stampede the
   * persistence hook.
   */
  setLocale(input: string): string {
    const next = this.resolve(input);
    const previous = this.current;
    if (next === previous) return next;
    this.current = next;
    this.cachedChain = localeChain(next, this.canonicalLocale);
    this.persistenceHook?.write(next);
    const change: LocaleChange = { previous, locale: next, chain: this.cachedChain };
    for (const listener of [...this.listeners]) listener(change);
    return next;
  }

  /**
   * Make a pack available.
   *
   * By default the pack is **merged** into whatever is already registered for its
   * locale, which is what lets one language be split across files
   * (`zh_CN.messages.json` + `zh_CN.elements.json`) and lets an external pack be
   * added at runtime without a code change. Pass `{ replace: true }` to drop the
   * previously registered pack for that locale instead (a clean reload).
   */
  registerPack(pack: LanguagePack, options: { replace?: boolean } = {}): void {
    const existing = this.packsByLocale.get(pack.locale);
    this.packsByLocale.set(
      pack.locale,
      existing === undefined || options.replace === true ? pack : mergePacks(existing, pack),
    );
  }

  /** Parse and register an external pack (the "add a language, zero code" path). */
  loadPack(json: unknown, options: { replace?: boolean } = {}): LanguagePack {
    const pack = loadLanguagePack(json);
    this.registerPack(pack, options);
    return pack;
  }

  /** Parse and register a pack from its JSON text. */
  loadPackText(text: string, source = '<inline>', options: { replace?: boolean } = {}): LanguagePack {
    const pack = parsePack(text, source);
    this.registerPack(pack, options);
    return pack;
  }

  pack(locale: string): LanguagePack | undefined {
    return this.packsByLocale.get(locale);
  }

  has(locale: string): boolean {
    return this.packsByLocale.has(locale);
  }

  /** Registered locales, sorted. */
  availableLocales(): string[] {
    return [...this.packsByLocale.keys()].sort();
  }

  /** Subscribe to locale changes; returns the unsubscribe function. */
  onChange(listener: LocaleListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
