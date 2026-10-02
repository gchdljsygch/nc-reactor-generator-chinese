import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfig2 } from '../src/config2.js';
import {
  DEFAULT_SETTINGS_LANGUAGE,
  LEGACY_MODULE_NAMES,
  SETTINGS_JSON_VERSION,
  decodeLegacySettings,
  migrateSettings,
  migrateSettingsFile,
  readLegacySettingsPath,
  serializeAppSettings,
  type LegacySettings,
} from '../src/legacy/settings.js';

/**
 * R2.11 — `settings.dat` (`config2`) → JSON settings migration.
 *
 * The acceptance criteria are: the repo's real `settings.dat` decodes to the
 * live values of the frozen app (checked against the raw config, not against
 * the decoder), the new document carries a `language` field, and nothing the
 * legacy file held is dropped silently.
 */
const SETTINGS_PATH = 'settings.dat';

function decodeRepo(): { settings: LegacySettings; issues: string[] } {
  return readLegacySettingsPath(SETTINGS_PATH);
}

describe('r2.11 legacy settings decoding', () => {
  it('reads the repo settings.dat as config2', () => {
    const raw = parseConfig2(readFileSync(SETTINGS_PATH), SETTINGS_PATH);
    expect(raw.properties()).toEqual([
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
    ]);
  });

  it('decodes every value the file carries', () => {
    const { settings, issues } = decodeRepo();
    expect(issues).toEqual([]);
    expect(settings.theme).toBe('Light');
    expect(settings.themeLegacyId).toBeNull();
    expect(settings.modules).toEqual({
      core: true,
      underhaul: true,
      overhaul: true,
      fusion_test: false,
      rainbow_factor: false,
      prime_fuel: false,
      quantum_traversed_efficiency_score: false,
      tinkers_construct: false,
      _internal: false,
    });
    expect(settings.overlays).toEqual({});
    expect(settings.tutorialShown).toBe(true);
    expect(settings.invertUndoRedo).toBe(false);
    expect(settings.autoBuildCasing).toBe(true);
    expect(settings.vsync).toBe(true);
    expect(settings.editor3dView).toBe(false);
    expect(settings.imageExport3DView).toBe(true);
    expect(settings.imageExportCasing).toBe(true);
    expect(settings.imageExportCasing3D).toBe(true);
    expect(settings.imageExportCasingParts).toBe(true);
    expect(settings.dssl).toBe(false);
    expect(settings.rememberConfig).toBe(false);
    expect(settings.mainMenu3dView).toBe(true);
    expect(settings.lastLoadedConfig).toBe('default');
    expect(settings.cursor).toEqual({
      xMult: 1,
      yMult: 1,
      xGuiScale: 1,
      yGuiScale: 1,
      xOffset: 0,
      yOffset: 0,
    });
    expect(settings.pins).toEqual([]);
    expect(settings.extras).toEqual({});
  });

  it('keeps unknown top-level keys verbatim in extras', () => {
    // A file written by a *newer* legacy build: an unmodelled key must survive.
    const { settings, issues } = decodeLegacySettings(
      parseConfig2(readFileSync(SETTINGS_PATH), SETTINGS_PATH),
      { source: 'settings.dat' },
    );
    expect(issues).toEqual([]);
    expect(Object.keys(settings.extras)).toEqual([]);

    const synthetic = decodeLegacySettings(
      (() => {
        const raw = parseConfig2(readFileSync(SETTINGS_PATH), SETTINGS_PATH);
        raw.setValue('futureKey', 'futureValue');
        raw.setValue('futureNumber', 7);
        return raw;
      })(),
      { source: 'synthetic.dat' },
    );
    expect(synthetic.settings.extras).toEqual({ futureKey: 'futureValue', futureNumber: 7 });
  });
});

describe('r2.11 JSON settings document', () => {
  it('carries the canonical language by default and an explicit one on request', () => {
    const legacy = decodeRepo().settings;
    const defaulted = migrateSettings(legacy, { source: SETTINGS_PATH });
    expect(defaulted.settings.language).toBe(DEFAULT_SETTINGS_LANGUAGE);
    expect(defaulted.settings.language).toBe('en_US');
    expect(defaulted.settings.version).toBe(SETTINGS_JSON_VERSION);

    // The fork's own localizer was hardcoded Chinese (Localization.java:5), so
    // `--language zh_CN` is the fork-appropriate value.
    const chinese = migrateSettings(legacy, { language: 'zh_CN', source: SETTINGS_PATH });
    expect(chinese.settings.language).toBe('zh_CN');
    expect(chinese.settings.language).not.toBe(DEFAULT_SETTINGS_LANGUAGE);
  });

  it('migrates the whole file with nothing silently dropped', () => {
    const migration = migrateSettingsFile(SETTINGS_PATH);
    const { settings } = migration;
    expect(settings.version).toBe(1);
    expect(settings.language).toBe('en_US');
    expect(settings.theme).toBe('Light');
    expect(settings.legacy).toEqual({ theme_type: 'name' });
    expect(settings.extras).toEqual({});
    expect(Object.keys(settings.modules).sort()).toEqual([...LEGACY_MODULE_NAMES].sort());
    expect(settings.ui).toEqual({
      tutorialShown: true,
      invertUndoRedo: false,
      autoBuildCasing: true,
      vsync: true,
      editor3dView: false,
      mainMenu3dView: true,
      rememberConfig: false,
      dssl: false,
      lastLoadedConfig: 'default',
    });
    expect(settings.export).toEqual({
      view3d: true,
      casing: true,
      casing3d: true,
      casingParts: true,
    });
    expect(settings.cursor).toEqual({
      xMult: 1,
      yMult: 1,
      xGuiScale: 1,
      yGuiScale: 1,
      xOffset: 0,
      yOffset: 0,
    });
    expect(settings.pins).toEqual([]);

    // The three asymmetries of the legacy code are reported, not hidden.
    expect(migration.issues.some((issue) => issue.includes('no "language" key'))).toBe(true);
    expect(
      migration.issues.some((issue) =>
        issue.includes('"imageExportCasingParts" is written by Core.java:363 but never read'),
      ),
    ).toBe(true);
    expect(migration.issues.some((issue) => issue.includes('cursor.xOff=0'))).toBe(true);
  });

  it('serializes to stable, re-readable JSON', () => {
    const { settings } = migrateSettingsFile(SETTINGS_PATH);
    const text = serializeAppSettings(settings);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(settings);
  });

  it('keeps a legacy numeric theme verbatim instead of inventing a name', () => {
    // Pre-`Theme.name` files store the ordinal; MenuInit reads it through
    // Theme.getByLegacyID, which the rewrite does not port.
    const legacy: LegacySettings = {
      ...decodeRepo().settings,
      theme: null,
      themeLegacyId: 3,
    };
    const migration = migrateSettings(legacy, { source: 'old.dat' });
    expect(migration.settings.theme).toBeNull();
    expect(migration.settings.legacy).toEqual({ theme_id: 3, theme_type: 'legacy_id' });
    expect(migration.issues.some((issue) => issue.includes('legacy id 3'))).toBe(true);
  });

  it('applies the legacy read defaults to a settings file that is missing keys', () => {
    // Only `theme` present: everything else must fall back to MenuInit's
    // defaults (autoBuildCasing/vsync/imageExport*/mainMenu3dView true, the
    // rest false/1/"default", cursor offsets 1).
    const minimal = decodeLegacySettings(
      (() => {
        const raw = parseConfig2(readFileSync(SETTINGS_PATH), SETTINGS_PATH);
        for (const key of raw.properties()) if (key !== 'theme') raw.removeProperty(key);
        return raw;
      })(),
      { source: 'minimal.dat' },
    );
    const settings = minimal.settings;
    expect(settings.theme).toBe('Light');
    expect(settings.modules).toEqual({});
    expect(settings.overlays).toEqual({});
    expect(settings.tutorialShown).toBe(false);
    expect(settings.invertUndoRedo).toBe(false);
    expect(settings.autoBuildCasing).toBe(true);
    expect(settings.vsync).toBe(true);
    expect(settings.editor3dView).toBe(false);
    expect(settings.imageExport3DView).toBe(true);
    expect(settings.imageExportCasing).toBe(true);
    expect(settings.imageExportCasing3D).toBe(true);
    expect(settings.imageExportCasingParts).toBe(true);
    expect(settings.dssl).toBe(false);
    expect(settings.rememberConfig).toBe(false);
    expect(settings.mainMenu3dView).toBe(true);
    expect(settings.lastLoadedConfig).toBe('default');
    expect(settings.cursor).toEqual({
      xMult: 1,
      yMult: 1,
      xGuiScale: 1,
      yGuiScale: 1,
      xOffset: 1,
      yOffset: 1,
    });
    expect(settings.pins).toEqual([]);
    expect(minimal.issues.some((issue) => issue.includes('no "modules" section'))).toBe(true);
  });

  it('does not throw on a file with a missing or unusable theme', () => {
    // MenuInit.java:186 casts a missing theme to int and NPEs; the migration
    // must instead record the value it could not represent.
    const raw = parseConfig2(readFileSync(SETTINGS_PATH), SETTINGS_PATH);
    raw.removeProperty('theme');
    const decoded = decodeLegacySettings(raw, { source: 'themeless.dat' });
    expect(decoded.settings.theme).toBeNull();
    expect(decoded.settings.themeLegacyId).toBeNull();
    expect(decoded.issues.some((issue) => issue.includes('"theme" is absent'))).toBe(true);
    const migration = migrateSettings(decoded.settings, { source: 'themeless.dat' });
    expect(migration.settings.legacy).toEqual({ theme_type: 'absent' });
  });
});
