/**
 * R3.2 — application settings, including the active language.
 *
 * The rewrite replaces the `config2` `settings.dat` with JSON
 * (`docs/rewrite-plan-r1-r5.md` §2.2: "config2 → do not port; write a one-off
 * migration tool, the new project stores settings as JSON"), and R2.11 ships
 * that migration (`tools/ts/migrate-settings.mjs`). This module owns the *new*
 * shape and its persistence:
 *
 *  - **Browser**: `localStorage`, so the language survives a reload (R3.2:
 *    "运行时切换，无需重启；刷新后保持");
 *  - **Tests/Node**: any `Storage`-like object, injected (no `window` needed).
 *
 * Unknown keys coming from a migrated `settings.dat` are kept verbatim in
 * `legacy` so a migration can never silently drop a user's configuration.
 */

export const SETTINGS_VERSION = 1;

/** The two built-in themes (R3.1 — CSS variables, not 5,107 lines of Java). */
export const THEMES = ['dark', 'light'] as const;
export type ThemeName = (typeof THEMES)[number];

export interface AppSettings {
  readonly version: number;
  /** BCP-47-ish locale tag, e.g. `zh_CN` / `en_US`. */
  language: string;
  theme: ThemeName;
  /** Configuration id selected on startup (`nuclearcraft:overhaul_sfr`). */
  lastConfiguration: string | null;
  /** `2d` (top view) or `3d`. */
  viewMode: '2d' | '3d';
  /** 3D view: hide every layer above/below the slice. */
  sliceAxis: 0 | 1 | 2;
  sliceIndex: number;
  /** 3D view: render only the outer shell. */
  shellOnly: boolean;
  /** Blocks per second while dragging in the editor. */
  autoCalculate: boolean;
  /**
   * R2.12 — `Core.imageExportCasingParts` (`Core.java:111`, default `true`): keep
   * the casing/port/controller/vent/glass lines in an exported image's parts list.
   */
  imageExportCasingParts: boolean;
  /**
   * R4.4 — how many parallel generator lanes to run. Java exposed the same slider
   * (`MenuGenerator.threads`) with no ceiling; `1` is the honest default while the
   * pool is single-threaded (see `docs/r4/README.md`).
   */
  generatorThreads: number;
  /**
   * R4.4 — how many iterations a run is asked for. Java's generator ran until a stage
   * machine said stop; a fixed budget is what makes a run reproducible and time-bounded.
   */
  generatorIterations: number;
  /** Kept verbatim from a migrated legacy `settings.dat`. */
  legacy: Record<string, unknown>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SETTINGS_KEY = 'ncplanner.settings';

export function defaultSettings(): AppSettings {
  return {
    version: SETTINGS_VERSION,
    language: 'en_US',
    theme: 'dark',
    lastConfiguration: null,
    viewMode: '2d',
    sliceAxis: 1,
    sliceIndex: 0,
    shellOnly: false,
    autoCalculate: true,
    imageExportCasingParts: true,
    generatorThreads: 1,
    generatorIterations: 20_000,
    legacy: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerce an arbitrary parsed object into valid settings. Every field is
 * validated independently, so a settings file from a future version (or a
 * hand-edited one) degrades field by field instead of throwing — an app that
 * cannot start because of one bad key is a worse failure than a reset theme.
 */
export function normalizeSettings(input: unknown, base: AppSettings = defaultSettings()): AppSettings {
  if (!isRecord(input)) return base;
  const out: AppSettings = { ...base };
  const language = input['language'];
  if (typeof language === 'string' && language.length > 0) out.language = language;
  const theme = input['theme'];
  if (typeof theme === 'string' && (THEMES as readonly string[]).includes(theme)) {
    out.theme = theme as ThemeName;
  }
  const lastConfiguration = input['lastConfiguration'];
  if (typeof lastConfiguration === 'string' || lastConfiguration === null) {
    out.lastConfiguration = lastConfiguration;
  }
  const viewMode = input['viewMode'];
  if (viewMode === '2d' || viewMode === '3d') out.viewMode = viewMode;
  const sliceAxis = input['sliceAxis'];
  if (sliceAxis === 0 || sliceAxis === 1 || sliceAxis === 2) out.sliceAxis = sliceAxis;
  const sliceIndex = input['sliceIndex'];
  if (typeof sliceIndex === 'number' && Number.isFinite(sliceIndex)) {
    out.sliceIndex = Math.max(0, Math.trunc(sliceIndex));
  }
  if (typeof input['shellOnly'] === 'boolean') out.shellOnly = input['shellOnly'];
  if (typeof input['autoCalculate'] === 'boolean') out.autoCalculate = input['autoCalculate'];
  if (typeof input['imageExportCasingParts'] === 'boolean') {
    out.imageExportCasingParts = input['imageExportCasingParts'];
  }
  const generatorThreads = input['generatorThreads'];
  if (typeof generatorThreads === 'number' && Number.isFinite(generatorThreads)) {
    // Clamp to a range that cannot produce more lanes than a browser will schedule.
    out.generatorThreads = Math.min(32, Math.max(1, Math.trunc(generatorThreads)));
  }
  const generatorIterations = input['generatorIterations'];
  if (typeof generatorIterations === 'number' && Number.isFinite(generatorIterations)) {
    out.generatorIterations = Math.min(10_000_000, Math.max(1, Math.trunc(generatorIterations)));
  }
  if (isRecord(input['legacy'])) out.legacy = { ...input['legacy'] };
  return out;
}

export interface SettingsStoreOptions {
  readonly storage?: StorageLike;
  readonly key?: string;
  /** In-memory seed used when the storage has nothing (and by tests). */
  readonly initial?: Partial<AppSettings>;
}

/** Small observable settings store; the UI subscribes and re-renders. */
export class SettingsStore {
  private readonly storage: StorageLike | undefined;
  private readonly key: string;
  private state: AppSettings;
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor(options: SettingsStoreOptions = {}) {
    this.storage = options.storage;
    this.key = options.key ?? SETTINGS_KEY;
    const stored = this.readStored();
    this.state = normalizeSettings(
      stored ?? options.initial ?? {},
      { ...defaultSettings(), ...options.initial },
    );
  }

  get current(): AppSettings {
    return this.state;
  }

  private readStored(): unknown {
    if (this.storage === undefined) return undefined;
    const text = this.storage.getItem(this.key);
    if (text === null || text.length === 0) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // A corrupted entry must not brick the app: fall back to defaults and
      // overwrite it on the next change.
      return undefined;
    }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next = normalizeSettings({ ...this.state, ...patch }, this.state);
    this.state = next;
    this.persist();
    for (const listener of [...this.listeners]) listener(next);
    return next;
  }

  replace(settings: AppSettings): AppSettings {
    return this.update(settings);
  }

  onChange(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Serialised form (what `localStorage` holds and what an export writes). */
  toJson(): string {
    return JSON.stringify(this.state, null, 2);
  }

  private persist(): void {
    this.storage?.setItem(this.key, JSON.stringify(this.state));
  }
}

/** `window.localStorage` when it exists *and is usable* (it throws in some privacy modes). */
export function browserStorage(): StorageLike | undefined {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (storage === undefined) return undefined;
    const probe = 'ncplanner.probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return undefined;
  }
}
