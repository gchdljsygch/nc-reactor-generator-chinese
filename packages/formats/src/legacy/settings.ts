/**
 * R2.11 — the legacy `settings.dat` (`config2`) decoder and the JSON settings
 * document the rewrite persists.
 *
 * Java sources (frozen baseline):
 *
 *  - **write** — `planner/Core.java:342-379`: builds `settings.dat` from the
 *    live `Core` statics: `theme`, `modules` (name → `Module.isActive()`),
 *    `overlays` (name → int), `tutorialShown`, `invertUndoRedo`,
 *    `autoBuildCasing`, `vsync`, `editor3dView`, `imageExport3DView`,
 *    `imageExportCasing`, `imageExportCasing3D`, `imageExportCasingParts`,
 *    `dssl`, `rememberConfig`, `mainMenu3dView`, `lastLoadedConfig` (written
 *    only when non-null), `cursor` (`MenuCalibrateCursor.xMult/yMult/xGUIScale/
 *    yGUIScale/xOff/yOff`) and `pins` (a `ConfigList` of display-name strings).
 *  - **read** — `planner/gui/menu/MenuInit.java:151-227`: the *defaults* live
 *    here and they do **not** all match the write path (see "asymmetries").
 *  - the container format itself is `config2` — already ported in
 *    `../config2.ts`; this module adds only the meaning of the keys.
 *
 * Asymmetries between the two Java paths (all reproduced, none "fixed"):
 *
 *  1. `imageExportCasingParts` is **written but never read**: `Core.java:363`
 *     saves it, `MenuInit` has no matching `settings.get(...)`. Its only effect
 *     is the `PNGWriter`/`MenuImageExportPreview` toggle, which the legacy app
 *     therefore always starts at its in-code default (`true`). The migrated
 *     document keeps the stored value and flags the asymmetry.
 *  2. `cursor.xOff` / `cursor.yOff` are read with the default **1**
 *     (`MenuInit.java:219-220`) while the writer stores the live value (the
 *     shipped `settings.dat` holds `0`). The migrated document keeps the stored
 *     value; the differing legacy default is recorded as an issue.
 *  3. `theme` may be a `String` (current) or an `Integer` (pre-`Theme.name`
 *     files, read through `Theme.getByLegacyID`). Only the string form can be
 *     represented as a theme *name*; a numeric theme is kept verbatim in
 *     `legacy.theme_id` because `Theme.getByLegacyID` needs Java's `Theme`
 *     enum, which the rewrite does not port.
 *  4. `settings.get(key, default)` in Java **mutates** the loaded config
 *     (appends the missing key). This decoder only reads, so the property
 *     order Java would observe afterwards is not reproduced — nothing in the
 *     new app depends on it.
 *
 * The persisted shape ({@link AppSettings}) is new (there is no legacy
 * equivalent): a `version` for future migrations plus a `language` field for the
 * R1.2 i18n layer. `language` is **not** in the legacy file — the fork hardcoded
 * its localizer (`localization/Localization.java:5` →
 * `new SimplifiedChineseLocalizer()`), so there is nothing to migrate from and
 * the caller must choose (CLI `--language`, default `en_US`).
 *
 * Two provenance bags keep the migration lossless:
 *  - `extras` — every top-level legacy key this module does not model, verbatim;
 *  - `legacy` — legacy values that have no representation in the new shape
 *    (a numeric theme id, a mismatched setting type…), plus the theme form.
 *
 * Java references: `planner/Core.java`, `planner/gui/menu/MenuInit.java`,
 * `planner/module/Module.java`, `planner/gui/menu/dialog/MenuCalibrateCursor.java`.
 */
import { readFileSync } from 'node:fs';
import { ConfigList, ConfigObject, parseConfig2, type ConfigValue } from '../config2.js';

/**
 * The canonical language of the rewrite, duplicated from
 * `@ncplanner/i18n`'s `CANONICAL_LOCALE` (`packages/i18n/src/locale.ts:17`)
 * because `@ncplanner/formats` is a leaf package that must not depend on the
 * localisation layer (see `tools/ts/lint.mjs`, rule 1 — the same reason the
 * kernel is not allowed to import it).
 */
export const DEFAULT_SETTINGS_LANGUAGE = 'en_US';

/** Schema version of the persisted JSON document. */
export const SETTINGS_JSON_VERSION = 1;

/** `Module.name` values the legacy app could apply (`Core.modules` in `MenuInit`). */
export const LEGACY_MODULE_NAMES: readonly string[] = [
  'core',
  'underhaul',
  'overhaul',
  'fusion_test',
  'rainbow_factor',
  'prime_fuel',
  'quantum_traversed_efficiency_score',
  'tinkers_construct',
  '_internal',
];

export interface LegacyCursorSettings {
  readonly xMult: number;
  readonly yMult: number;
  readonly xGuiScale: number;
  readonly yGuiScale: number;
  /** Legacy `cursor.xOff`; read with default 1, written from the live value. */
  readonly xOffset: number;
  readonly yOffset: number;
}

/**
 * `settings.dat` decoded with `MenuInit`'s defaults applied, so every field is
 * present even when the file omits it.
 */
export interface LegacySettings {
  /** `theme` when it is a name (`Theme.name`); `null` for a legacy numeric id. */
  readonly theme: string | null;
  /** `theme` when it is an `Integer` (pre-name files); otherwise `null`. */
  readonly themeLegacyId: number | null;
  /** `modules`: module name → active. Kept verbatim (no filtering). */
  readonly modules: Readonly<Record<string, boolean>>;
  /** `overlays`: overlay name → int. */
  readonly overlays: Readonly<Record<string, number>>;
  readonly tutorialShown: boolean;
  readonly invertUndoRedo: boolean;
  readonly autoBuildCasing: boolean;
  readonly vsync: boolean;
  readonly editor3dView: boolean;
  readonly imageExport3DView: boolean;
  readonly imageExportCasing: boolean;
  readonly imageExportCasing3D: boolean;
  readonly imageExportCasingParts: boolean;
  readonly dssl: boolean;
  readonly rememberConfig: boolean;
  readonly mainMenu3dView: boolean;
  readonly lastLoadedConfig: string;
  readonly cursor: LegacyCursorSettings;
  readonly pins: readonly string[];
  /** Top-level keys this decoder does not model, as a plain JSON view. */
  readonly extras: Readonly<Record<string, unknown>>;
}

/** The new document's UI section. */
export interface AppSettingsUi {
  readonly tutorialShown: boolean;
  readonly invertUndoRedo: boolean;
  readonly autoBuildCasing: boolean;
  readonly vsync: boolean;
  readonly editor3dView: boolean;
  readonly mainMenu3dView: boolean;
  readonly rememberConfig: boolean;
  readonly dssl: boolean;
  readonly lastLoadedConfig: string;
}

/** The new document's image-export section (`Core.imageExport*`). */
export interface AppSettingsExport {
  readonly view3d: boolean;
  readonly casing: boolean;
  readonly casing3d: boolean;
  /** Written by the legacy app, never read back by it (asymmetry 1). */
  readonly casingParts: boolean;
}

export interface AppSettingsCursor {
  readonly xMult: number;
  readonly yMult: number;
  readonly xGuiScale: number;
  readonly yGuiScale: number;
  readonly xOffset: number;
  readonly yOffset: number;
}

/** The JSON settings document the rewrite persists (`settings.json`). */
export interface AppSettings {
  readonly version: number;
  /** R1.2 locale tag, e.g. `en_US` / `zh_CN`; the legacy file has no such key. */
  readonly language: string;
  readonly theme: string | null;
  readonly modules: Record<string, boolean>;
  readonly overlays: Record<string, number>;
  readonly ui: AppSettingsUi;
  readonly export: AppSettingsExport;
  readonly cursor: AppSettingsCursor;
  readonly pins: string[];
  /** Legacy keys with no modelled home, verbatim. */
  readonly extras: Record<string, unknown>;
  /** Legacy values that could not be represented, verbatim. */
  readonly legacy: Record<string, unknown>;
}

export interface SettingsMigration {
  /** The document to persist. */
  readonly settings: AppSettings;
  /** Everything the migration could not carry over faithfully. */
  readonly issues: readonly string[];
}

export interface MigrateSettingsOptions {
  /** Locale tag for the new app; default {@link DEFAULT_SETTINGS_LANGUAGE}. */
  readonly language?: string;
  /** Label recorded in issues (defaults to `settings.dat`). */
  readonly source?: string;
}

/** Keys this module models; everything else lands in `extras`. */
const MODELLED_KEYS: readonly string[] = [
  'theme',
  'modules',
  'overlays',
  'tutorialShown',
  'invertUndoRedo',
  'autoBuildCasing',
  'vsync',
  'editor3dView',
  'imageExport3DView',
  'imageExportCasing',
  'imageExportCasing3D',
  'imageExportCasingParts',
  'dssl',
  'rememberConfig',
  'mainMenu3dView',
  'lastLoadedConfig',
  'cursor',
  'pins',
];

class IssueLog {
  private readonly seen = new Set<string>();
  private readonly lines: string[] = [];

  add(message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    this.lines.push(message);
  }

  list(): string[] {
    return [...this.lines];
  }
}

/** `Config.get(key)`, with a type check and an issue instead of a `ClassCastException`. */
function scalar(
  config: ConfigObject,
  key: string,
  kind: 'string' | 'boolean' | 'number',
  issues: IssueLog,
  where: string,
): ConfigValue | null {
  if (!config.hasProperty(key)) return null;
  const value = config.get(key);
  if (kind === 'string' && typeof value === 'string') return value;
  if (kind === 'boolean' && typeof value === 'boolean') return value;
  if (kind === 'number' && typeof value === 'number') return value;
  issues.add(
    `${where}: "${key}" is ${describe(value)}, not a ${kind}; the legacy default is used instead`,
  );
  return null;
}

function legacyBoolean(
  config: ConfigObject,
  key: string,
  fallback: boolean,
  issues: IssueLog,
  where: string,
): boolean {
  const value = scalar(config, key, 'boolean', issues, where);
  return typeof value === 'boolean' ? value : fallback;
}

function legacyNumber(
  config: ConfigObject,
  key: string,
  fallback: number,
  issues: IssueLog,
  where: string,
): number {
  const value = scalar(config, key, 'number', issues, where);
  return typeof value === 'number' ? value : fallback;
}

function legacyString(
  config: ConfigObject,
  key: string,
  fallback: string,
  issues: IssueLog,
  where: string,
): string {
  const value = scalar(config, key, 'string', issues, where);
  return typeof value === 'string' ? value : fallback;
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return 'absent';
  if (value instanceof ConfigObject) return 'a config';
  if (value instanceof ConfigList) return 'a list';
  if (typeof value === 'bigint') return `a long (${value})`;
  return `${typeof value} ${JSON.stringify(value)}`;
}

/**
 * Decode a `config2` settings root exactly as `MenuInit` reads it.
 *
 * Missing keys, wrong types and malformed sections never throw: the legacy
 * default is used and an issue is returned, because a settings file is not
 * worth losing the application over (the legacy app instead NPEs — see
 * `MenuInit.java:186`, where a missing `theme` is cast to `int`).
 */
export function decodeLegacySettings(
  root: ConfigObject,
  options: { source?: string } = {},
): { settings: LegacySettings; issues: string[] } {
  const where = options.source ?? 'settings.dat';
  const issues = new IssueLog();

  // theme: String (name) or Integer (legacy id) — MenuInit.java:183-186.
  let theme: string | null = null;
  let themeLegacyId: number | null = null;
  const rawTheme = root.get('theme');
  if (typeof rawTheme === 'string') theme = rawTheme;
  else if (typeof rawTheme === 'number') themeLegacyId = Math.trunc(rawTheme);
  else if (typeof rawTheme === 'bigint') themeLegacyId = Number(rawTheme);
  else {
    issues.add(
      `${where}: "theme" is ${describe(rawTheme)}; Java's Theme.getByLegacyID((int)o) would throw, so the new document leaves it null`,
    );
  }

  // modules: name -> active. Java only applies names that match a live module.
  const modules: Record<string, boolean> = {};
  const modulesConfig = root.getObject('modules');
  if (modulesConfig === null) {
    if (root.hasProperty('modules')) {
      issues.add(`${where}: "modules" is not a config; every module state was dropped`);
    } else {
      issues.add(`${where}: no "modules" section; the new document keeps the new app's defaults`);
    }
  } else {
    for (const key of modulesConfig.properties()) {
      const value = modulesConfig.get(key);
      if (typeof value !== 'boolean') {
        issues.add(`${where}: module "${key}" is ${describe(value)}; dropped`);
        continue;
      }
      modules[key] = value;
      if (!LEGACY_MODULE_NAMES.includes(key)) {
        issues.add(`${where}: module "${key}" is not a module of the legacy app; kept verbatim`);
      }
    }
  }

  // overlays: name -> int (MenuInit.java:155-158).
  const overlays: Record<string, number> = {};
  const overlaysConfig = root.getObject('overlays');
  if (overlaysConfig === null) {
    if (root.hasProperty('overlays')) {
      issues.add(`${where}: "overlays" is not a config; every overlay state was dropped`);
    }
  } else {
    for (const key of overlaysConfig.properties()) {
      const value = overlaysConfig.get(key);
      if (typeof value === 'number') overlays[key] = Math.trunc(value);
      else if (typeof value === 'bigint') overlays[key] = Number(value);
      else issues.add(`${where}: overlay "${key}" is ${describe(value)}; dropped`);
    }
  }

  const cursorConfig = root.getObject('cursor');
  if (cursorConfig === null && root.hasProperty('cursor')) {
    issues.add(`${where}: "cursor" is not a config; the legacy cursor defaults are used`);
  }
  const cursor: LegacyCursorSettings = {
    xMult: cursorConfig === null ? 1 : legacyNumber(cursorConfig, 'xMult', 1, issues, where),
    yMult: cursorConfig === null ? 1 : legacyNumber(cursorConfig, 'yMult', 1, issues, where),
    xGuiScale: cursorConfig === null ? 1 : legacyNumber(cursorConfig, 'xGUIScale', 1, issues, where),
    yGuiScale: cursorConfig === null ? 1 : legacyNumber(cursorConfig, 'yGUIScale', 1, issues, where),
    // MenuInit.java:219-220 reads these two with default 1 (the writer stores 0).
    xOffset: cursorConfig === null ? 1 : legacyNumber(cursorConfig, 'xOff', 1, issues, where),
    yOffset: cursorConfig === null ? 1 : legacyNumber(cursorConfig, 'yOff', 1, issues, where),
  };

  const pins: string[] = [];
  const pinList = root.getList('pins');
  if (pinList === null) {
    if (root.hasProperty('pins')) {
      issues.add(`${where}: "pins" is not a list; every pinned name was dropped`);
    }
  } else {
    for (let i = 0; i < pinList.size(); i++) {
      const value = pinList.get(i);
      if (typeof value === 'string') pins.push(value);
      else issues.add(`${where}: pins[${i}] is ${describe(value)}; dropped`);
    }
  }

  const settings: LegacySettings = {
    theme,
    themeLegacyId,
    modules,
    overlays,
    tutorialShown: legacyBoolean(root, 'tutorialShown', false, issues, where),
    invertUndoRedo: legacyBoolean(root, 'invertUndoRedo', false, issues, where),
    autoBuildCasing: legacyBoolean(root, 'autoBuildCasing', true, issues, where),
    vsync: legacyBoolean(root, 'vsync', true, issues, where),
    editor3dView: legacyBoolean(root, 'editor3dView', false, issues, where),
    imageExport3DView: legacyBoolean(root, 'imageExport3DView', true, issues, where),
    imageExportCasing: legacyBoolean(root, 'imageExportCasing', true, issues, where),
    imageExportCasing3D: legacyBoolean(root, 'imageExportCasing3D', true, issues, where),
    imageExportCasingParts: legacyBoolean(root, 'imageExportCasingParts', true, issues, where),
    dssl: legacyBoolean(root, 'dssl', false, issues, where),
    rememberConfig: legacyBoolean(root, 'rememberConfig', false, issues, where),
    mainMenu3dView: legacyBoolean(root, 'mainMenu3dView', true, issues, where),
    lastLoadedConfig: legacyString(root, 'lastLoadedConfig', 'default', issues, where),
    cursor,
    pins,
    extras: collectExtras(root),
  };

  return { settings, issues: issues.list() };
}

/** Every top-level key outside {@link MODELLED_KEYS}, as a plain JSON view. */
function collectExtras(root: ConfigObject): Record<string, unknown> {
  const view = root.toJson();
  const extras: Record<string, unknown> = {};
  if (view === null || typeof view !== 'object' || Array.isArray(view)) return extras;
  for (const [key, value] of Object.entries(view as Record<string, unknown>)) {
    if (!MODELLED_KEYS.includes(key)) extras[key] = value;
  }
  return extras;
}

/** Read and decode a `settings.dat`. */
export function readLegacySettingsPath(path: string): {
  settings: LegacySettings;
  issues: string[];
} {
  const bytes = readFileSync(path);
  return decodeLegacySettings(parseConfig2(bytes, path), { source: path });
}

/**
 * Turn a decoded legacy settings object into the new JSON document.
 *
 * Everything the legacy file carried is carried over. The only new value is
 * `language` (the legacy file has none — see the module header).
 */
export function migrateSettings(
  legacy: LegacySettings,
  options: MigrateSettingsOptions = {},
): SettingsMigration {
  const issues: string[] = [];
  const source = options.source ?? 'settings.dat';

  const language = (options.language ?? DEFAULT_SETTINGS_LANGUAGE).trim().replace(/-/g, '_');
  if (language === '') {
    throw new Error('migrateSettings: the language tag must not be empty');
  }
  issues.push(
    `${source}: the legacy file has no "language" key (the fork hardcoded its localizer), so the new document uses "${language}"`,
  );

  const legacyBag: Record<string, unknown> = {};
  if (legacy.themeLegacyId !== null) {
    legacyBag.theme_id = legacy.themeLegacyId;
    legacyBag.theme_type = 'legacy_id';
    issues.push(
      `${source}: "theme" is the legacy id ${legacy.themeLegacyId}; Theme.getByLegacyID is not ported, so the id is kept verbatim and "theme" stays null`,
    );
  } else if (legacy.theme !== null) {
    legacyBag.theme_type = 'name';
  } else {
    legacyBag.theme_type = 'absent';
  }
  issues.push(
    `${source}: "imageExportCasingParts" is written by Core.java:363 but never read by MenuInit; the stored value is kept and the legacy app always started from true`,
  );
  if (legacy.cursor.xOffset !== 1 || legacy.cursor.yOffset !== 1) {
    issues.push(
      `${source}: cursor.xOff=${legacy.cursor.xOffset}, cursor.yOff=${legacy.cursor.yOffset}; MenuInit.java:219-220 read them with the legacy default 1`,
    );
  }

  const settings: AppSettings = {
    version: SETTINGS_JSON_VERSION,
    language,
    theme: legacy.theme,
    modules: { ...legacy.modules },
    overlays: { ...legacy.overlays },
    ui: {
      tutorialShown: legacy.tutorialShown,
      invertUndoRedo: legacy.invertUndoRedo,
      autoBuildCasing: legacy.autoBuildCasing,
      vsync: legacy.vsync,
      editor3dView: legacy.editor3dView,
      mainMenu3dView: legacy.mainMenu3dView,
      rememberConfig: legacy.rememberConfig,
      dssl: legacy.dssl,
      lastLoadedConfig: legacy.lastLoadedConfig,
    },
    export: {
      view3d: legacy.imageExport3DView,
      casing: legacy.imageExportCasing,
      casing3d: legacy.imageExportCasing3D,
      casingParts: legacy.imageExportCasingParts,
    },
    cursor: {
      xMult: legacy.cursor.xMult,
      yMult: legacy.cursor.yMult,
      xGuiScale: legacy.cursor.xGuiScale,
      yGuiScale: legacy.cursor.yGuiScale,
      xOffset: legacy.cursor.xOffset,
      yOffset: legacy.cursor.yOffset,
    },
    pins: [...legacy.pins],
    extras: { ...legacy.extras },
    legacy: legacyBag,
  };

  return { settings, issues };
}

/** Read `settings.dat` and produce the new document in one step. */
export function migrateSettingsFile(
  path: string,
  options: MigrateSettingsOptions = {},
): SettingsMigration {
  const decoded = readLegacySettingsPath(path);
  const migration = migrateSettings(decoded.settings, { ...options, source: options.source ?? path });
  return { settings: migration.settings, issues: [...decoded.issues, ...migration.issues] };
}

/** The exact bytes to write for `settings.json`: pretty JSON, trailing newline. */
export function serializeAppSettings(settings: AppSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
