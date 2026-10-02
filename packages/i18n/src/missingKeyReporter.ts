/**
 * Missing-key reporting and aggregation (R1.2d).
 *
 * Two jobs, kept in one place because every bundle must do both:
 *
 *  - **dev mode**: warn on the console when a lookup could not be served by the
 *    user's locale. "Could not be served" includes the *coverage* case (found
 *    further down the chain, e.g. only in `en_US`) — that is the burn-down list
 *    CI needs, not just the hard-miss list;
 *  - **aggregation**: count events by kind / fallback / locale and expose the
 *    unique keys, so a test or a CI job can assert "0 untranslated keys".
 *
 * The reporter never rewrites text: it only records what the caller already
 * decided (see `MessageBundle` / `DataNameBundle`), which is what keeps the
 * "whole-string fallback only" rule observable in tests.
 */

export type MissingKeyKind = 'message' | 'plural' | 'element';

/**
 * Where the returned text came from.
 *
 *  - `self`           — the current locale provided the entry (never reported);
 *  - `language`       — the bare-language level (e.g. `zh` while using `zh_CN`);
 *  - `canonical`      — the canonical level (`en_US`);
 *  - `key`            — nothing provided the entry; the caller returned the key;
 *  - `canonical-name` — a data name fell back to the element's English name.
 */
export type MissingKeyFallback = 'self' | 'language' | 'canonical' | 'key' | 'canonical-name';

export interface MissingKeyEvent {
  readonly key: string;
  readonly kind: MissingKeyKind;
  /** The locale the user selected. */
  readonly locale: string;
  /** The locale the entry was actually found in (absent for `key`/`canonical-name`). */
  readonly resolvedLocale?: string;
  readonly fallback: MissingKeyFallback;
}

export interface MissingKeySummary {
  readonly total: number;
  readonly unique: number;
  readonly byKind: Readonly<Record<MissingKeyKind, number>>;
  readonly byFallback: Readonly<Record<MissingKeyFallback, number>>;
  readonly byLocale: Readonly<Record<string, number>>;
  /** Unique keys, sorted, in the order they were first reported. */
  readonly keys: readonly string[];
}

export interface MissingKeyReporterOptions {
  /** `false` disables recording entirely (production builds that do not care). */
  enabled?: boolean;
  /** `false` keeps the aggregation but stops the console warnings. */
  warn?: boolean;
  /** Warn once per `kind:key` pair instead of once per lookup (default `true`). */
  warnOnce?: boolean;
  /** Sink for warnings; defaults to `console.warn`. */
  logger?: (message: string) => void;
}

function emptyCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const key of keys) counts[key] = 0;
  return counts;
}

export class MissingKeyReporter {
  private readonly events: MissingKeyEvent[] = [];
  private readonly uniqueKeys = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly isEnabled: boolean;
  private readonly shouldWarn: boolean;
  private readonly warnOnce: boolean;
  private readonly logger: (message: string) => void;

  constructor(options: MissingKeyReporterOptions = {}) {
    this.isEnabled = options.enabled ?? true;
    this.shouldWarn = options.warn ?? process.env['NODE_ENV'] !== 'production';
    this.warnOnce = options.warnOnce ?? true;
    this.logger = options.logger ?? ((message: string) => console.warn(message));
  }

  get enabled(): boolean {
    return this.isEnabled;
  }

  /** Record one miss. `self`-fallbacks are not misses and are ignored. */
  report(event: MissingKeyEvent): void {
    if (!this.isEnabled) return;
    if (event.fallback === 'self') return;
    this.events.push(event);
    this.uniqueKeys.add(event.key);
    if (!this.shouldWarn) return;
    const id = `${event.kind}:${event.key}`;
    if (this.warnOnce && this.warned.has(id)) return;
    this.warned.add(id);
    const where = event.resolvedLocale === undefined ? '' : ` (found in ${event.resolvedLocale})`;
    this.logger(
      `[i18n] ${event.kind} key "${event.key}" is missing for locale ${event.locale}${where}; ` +
        `fell back to ${event.fallback}`,
    );
  }

  /** Every event, in report order. */
  list(): readonly MissingKeyEvent[] {
    return this.events;
  }

  /** Unique keys, in first-reported order. */
  keys(): readonly string[] {
    return [...this.uniqueKeys];
  }

  get size(): number {
    return this.events.length;
  }

  summary(): MissingKeySummary {
    const byKind = emptyCounts<MissingKeyKind>(['message', 'plural', 'element']);
    const byFallback = emptyCounts<MissingKeyFallback>([
      'self',
      'language',
      'canonical',
      'key',
      'canonical-name',
    ]);
    const byLocale: Record<string, number> = {};
    for (const event of this.events) {
      byKind[event.kind] += 1;
      byFallback[event.fallback] += 1;
      byLocale[event.locale] = (byLocale[event.locale] ?? 0) + 1;
    }
    return {
      total: this.events.length,
      unique: this.uniqueKeys.size,
      byKind,
      byFallback,
      byLocale,
      keys: [...this.uniqueKeys],
    };
  }

  /** Human-readable aggregation, for a dev console or a CI log. */
  format(): string {
    const summary = this.summary();
    if (summary.total === 0) return '[i18n] no missing keys';
    const kinds = (Object.entries(summary.byKind) as [MissingKeyKind, number][])
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${kind}=${count}`)
      .join(' ');
    const fallbacks = (Object.entries(summary.byFallback) as [MissingKeyFallback, number][])
      .filter(([, count]) => count > 0)
      .map(([fallback, count]) => `${fallback}=${count}`)
      .join(' ');
    return (
      `[i18n] missing keys: ${summary.total} lookups, ${summary.unique} unique (${kinds}); ` +
      `fallbacks: ${fallbacks}`
    );
  }

  reset(): void {
    this.events.length = 0;
    this.uniqueKeys.clear();
    this.warned.clear();
  }
}
