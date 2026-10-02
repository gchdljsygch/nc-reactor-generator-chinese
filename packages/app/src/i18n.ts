/**
 * R3.2 / R3.8 — the app's localization facade.
 *
 * The heavy lifting lives in `@ncplanner/i18n` (R1.2); this module is the glue
 * that the UI actually calls, and it is deliberately the *only* way the UI is
 * allowed to produce text:
 *
 *  - `t(key, args)` / `tc(key, n, args)` — UI copy; a missing key yields the key
 *    itself (never a half-translated sentence, see `MessageBundle`);
 *  - `elementName(...)` — data names, keyed by the four-segment identity
 *    `<config>/<cfgType>/<type>|<definition>`, falling back **whole** to the
 *    element's English canonical name;
 *  - `setLocale()` — switches at runtime, persists through the settings store and
 *    notifies listeners so the shell re-renders (no reload);
 *  - `loadPacks()` — built-in packs plus any user pack dropped into `lang/`
 *    (`registerExternalPack`), which is what makes "a new language is one JSON
 *    file" true at runtime (iron law 7).
 *
 * Everything is synchronous: the app loads its packs before the first render, so
 * a translation can never arrive after the frame that needed it.
 */

import {
  DataNameBundle,
  LocaleManager,
  MessageBundle,
  MissingKeyReporter,
  loadPack,
  type LanguagePack,
  type MessageArgs,
  type MissingKeySummary,
} from '@ncplanner/i18n';
import type { NCPFElement } from '@ncplanner/ncpf';
import type { SettingsStore } from './settings.js';

/** A pack plus where it came from (for the language menu). */
export interface LoadedPack {
  readonly pack: LanguagePack;
  readonly source: string;
}

export interface AppI18nOptions {
  /** Built-in packs (`lang/*.json`, loaded by the caller/main). */
  readonly packs?: readonly LanguagePack[];
  /** Where the selected language is persisted; usually the settings store. */
  readonly settings?: SettingsStore;
  /** Initial locale when the settings have none. */
  readonly initialLocale?: string;
  /** Sink for missing/unused key accounting (CI gate, dev overlay). */
  readonly reporter?: MissingKeyReporter;
}

/**
 * Locale list for the language menu: the built-ins plus anything else that got
 * registered. Sorted so the order never depends on load order.
 */
export interface LocaleOption {
  readonly locale: string;
  readonly name: string;
  /** True when this locale has its own pack (vs. falling back entirely). */
  readonly translated: boolean;
}

export class AppI18n {
  readonly locales: LocaleManager;
  readonly messages: MessageBundle;
  readonly dataNames: DataNameBundle;
  readonly reporter: MissingKeyReporter;

  private readonly settings: SettingsStore | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly packSources = new Map<string, string>();

  constructor(options: AppI18nOptions = {}) {
    this.settings = options.settings;
    this.reporter = options.reporter ?? new MissingKeyReporter();
    this.locales = new LocaleManager({
      // The settings store is the persistence hook (`LocalePersistence`), so a
      // language change is written once, by the one component that owns state.
      persistence:
        options.settings === undefined
          ? undefined
          : {
              read: () => options.settings?.current.language,
              write: (locale) => {
                options.settings?.update({ language: locale });
              },
            },
      initialLocale: options.initialLocale,
      packs: options.packs ?? [],
    });
    for (const pack of options.packs ?? []) this.packSources.set(pack.locale, 'built-in');
    this.messages = new MessageBundle(this.locales, { reporter: this.reporter });
    this.dataNames = new DataNameBundle(this.locales, { reporter: this.reporter });
  }

  get locale(): string {
    return this.locales.locale;
  }

  get canonical(): string {
    return this.locales.canonical;
  }

  get chain(): readonly string[] {
    return this.locales.chain();
  }

  /**
   * UI copy. `args` are either positional (`{0}`) or named (`{name}`);
   * positional slots may be written as a numeric record — `t('message.opened',
   * { 0: name })`, the convention every `ui/app.ts` call site uses — which
   * {@link appArgs} maps onto the array shape `@ncplanner/i18n` formats from.
   */
  t(key: string, args?: MessageArgs): string {
    return this.messages.tr(key, appArgs(args));
  }

  /** Plural-aware variant; `{0}`/`{n}` carry the count, further slots follow it. */
  tc(key: string, n: number, args?: MessageArgs): string {
    return this.messages.plural(key, n, appArgs(args));
  }

  has(key: string): boolean {
    return this.messages.has(key);
  }

  /**
   * Display name for a configuration element. `config`/`cfgType` are the first
   * two identity segments (see `DataNameBundle`); logic must keep using
   * `element.canonicalName`.
   */
  elementName(config: string, cfgType: string, element: NCPFElement): string {
    return this.dataNames.name(config, cfgType, element);
  }

  elementNameOr(key: string, canonicalName: string): string {
    return this.dataNames.nameOr(key, canonicalName);
  }

  setLocale(locale: string): string {
    const next = this.locales.setLocale(locale);
    // `LocaleManager` notifies its own listeners; the app-level listeners fire
    // here so a caller that only has the facade still gets one event per change.
    for (const listener of [...this.listeners]) listener();
    return next;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Register an external pack (the "new language, zero code" path). */
  registerExternalPack(json: unknown, source = '<external>'): LanguagePack {
    const pack = loadPack(json);
    this.locales.registerPack(pack);
    this.packSources.set(pack.locale, source);
    for (const listener of [...this.listeners]) listener();
    return pack;
  }

  options(): LocaleOption[] {
    const locales = new Set<string>([this.canonical, ...this.locales.availableLocales()]);
    return [...locales]
      .sort()
      .map((locale) => {
        const pack = this.locales.pack(locale);
        const name = pack?.meta.name ?? locale;
        return { locale, name, translated: pack !== undefined };
      });
  }

  sourceOf(locale: string): string | undefined {
    return this.packSources.get(locale);
  }

  /** Coverage snapshot for the CI gate / dev overlay (R3.8). */
  coverage(): MissingKeySummary {
    return this.reporter.summary();
  }

  /** True when the settings store was wired (i.e. language survives a reload). */
  get persisted(): boolean {
    return this.settings !== undefined;
  }
}

/**
 * The app's argument convention.
 *
 * `@ncplanner/i18n` reads positional placeholders (`{0}`) from an **array** and
 * named placeholders (`{name}`) from a record; the UI writes positional slots as
 * a *numeric record* (`t('message.opened', { 0: name })`). Handing that record
 * straight through leaves `{0}` in the output verbatim, because the formatter
 * only reads `context.positional[0]`, so a purely numeric record is normalised
 * here — one call-site convention for the whole UI, and the *pack* still decides
 * the order (`{ 0: 'A', 1: 'B' }` renders "A to B" in English, "B 由 A 生成" in
 * Chinese).
 *
 * A record with a non-numeric key (`{ name }`) is named args and goes through
 * untouched: `MessageArgs` cannot express both shapes at once, and a mixed call
 * stays visible as a literal `{0}` rather than being guessed at.
 */
function appArgs(args: MessageArgs | undefined): MessageArgs | undefined {
  if (args === undefined || Array.isArray(args)) return args;
  const entries = Object.entries(args as Readonly<Record<string, string | number>>);
  if (entries.length === 0 || entries.some(([key]) => !/^[0-9]+$/.test(key))) return args;
  const positional: (string | number)[] = [];
  for (const [key, value] of entries) positional[Number(key)] = value;
  return positional;
}
