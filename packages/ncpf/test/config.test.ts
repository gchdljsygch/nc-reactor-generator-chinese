import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  COMMON_MODULE,
  defineShippedModules,
  findElementByName,
  loadProjectFile,
  makeElement,
  moduleOf,
  ModuleRegistry,
  unknownModuleNames,
  type NCPFElement,
  type RawElement,
  type RawModules,
} from '@ncplanner/ncpf';

/**
 * R1.3 — the configuration model.
 *
 * Java loads 34 configurations through ~120 hand-written module classes and a
 * reflection/annotation registry (`@RegisterWith` + classgraph). In TS the module
 * set is declarative (`moduleSchema.ts`) and registration is explicit, so these
 * tests assert the two properties that matter:
 *
 *  1. the declarative schema covers every module the shipped configuration uses
 *     (otherwise a field would be silently unreadable);
 *  2. element identities inside a configuration are unique, so a dataset or a
 *     saved project can be resolved unambiguously.
 */

const CONFIG = fileURLToPath(
  new URL('../../../datasets/configurations/nuclearcraft.ncpf.json', import.meta.url),
);

const project = loadProjectFile(CONFIG);

function allModuleNames(modules: RawModules, into: Set<string>): void {
  for (const [name, payload] of Object.entries(modules)) {
    into.add(name);
    if (name === COMMON_MODULE.blockRecipes && Array.isArray(payload.recipes)) {
      for (const recipe of payload.recipes as RawElement[]) {
        allModuleNames(recipe.modules ?? {}, into);
      }
    }
    if (name === COMMON_MODULE.globalElements && Array.isArray(payload.elements)) {
      for (const element of payload.elements as RawElement[]) {
        allModuleNames(element.modules ?? {}, into);
      }
    }
  }
}

describe('shipped configuration', () => {
  it('exposes the four NuclearCraft reactor configurations', () => {
    expect(project.configurations.map((c) => c.id).sort()).toEqual([
      'nuclearcraft:overhaul_msr',
      'nuclearcraft:overhaul_sfr',
      'nuclearcraft:overhaul_turbine',
      'nuclearcraft:underhaul_sfr',
    ]);
  });

  it('carries the element counts the golden datasets were built from', () => {
    const sfr = project.getConfiguration('nuclearcraft:overhaul_sfr');
    const usfr = project.getConfiguration('nuclearcraft:underhaul_sfr');
    const msr = project.getConfiguration('nuclearcraft:overhaul_msr');
    const turbine = project.getConfiguration('nuclearcraft:overhaul_turbine');
    expect(sfr?.blocks.length).toBe(58);
    expect(sfr?.lists.get('coolant_recipes')?.length).toBe(2);
    expect(usfr?.blocks.length).toBe(21);
    expect(usfr?.lists.get('fuels')?.length).toBe(52);
    expect(msr?.blocks.length).toBe(120);
    expect(turbine?.blocks.length).toBe(20);
    expect(turbine?.lists.get('recipes')?.length).toBe(3);
  });

  it('has a declarative schema entry for every module used by the configuration', () => {
    const names = new Set<string>();
    for (const config of project.configurations) {
      allModuleNames(config.modules, names);
      for (const element of config.blocks) allModuleNames(element.modules, names);
      for (const [, list] of config.lists) {
        for (const element of list) allModuleNames(element.modules, names);
      }
    }
    const registry: ModuleRegistry = defineShippedModules(new ModuleRegistry());
    expect(unknownModuleNames(registry, names)).toEqual([]);
    // The schema is the replacement for the Java module classes; make sure it is
    // not accidentally shrinking.
    expect(registry.names().length).toBeGreaterThanOrEqual(45);
  });

  it('keeps element identities unique inside every configuration', () => {
    for (const config of project.configurations) {
      const seen = new Map<string, number>();
      for (const element of config.blocks) {
        const id = element.definition.identity;
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
      const duplicates = [...seen].filter(([, n]) => n > 1);
      // R0 finding #4 was about *names*; identities must be unique. Two entries
      // sharing an identity would make a saved grid unresolvable.
      expect(duplicates, `${config.id} has duplicate identities`).toEqual([]);
    }
  });

  it('distinguishes the blockstate variants that a lossy name collapses', () => {
    const sfr = project.getConfiguration('nuclearcraft:overhaul_sfr')!;
    const reflectors = sfr.blocks.filter((b) => b.definition.name === 'nuclearcraft:fission_reflector');
    expect(reflectors.length).toBe(2);
    const identities = new Set(reflectors.map((b) => b.definition.identity));
    expect(identities.size).toBe(2);
    const sinks = sfr.blocks.filter((b) => b.definition.name === 'nuclearcraft:solid_fission_sink');
    expect(sinks.length).toBeGreaterThan(1);
    expect(new Set(sinks.map((b) => b.definition.identity)).size).toBe(sinks.length);
  });
});

describe('import compatibility (iron law: logic uses canonical / legacy names)', () => {
  it('resolves an element by its English legacy name even when the display name is localized', () => {
    const raw: RawElement = {
      type: 'legacy_block',
      name: 'nuclearcraft:fission_casing',
      modules: {
        [COMMON_MODULE.displayName]: { display_name: '裂变外壳' },
        [COMMON_MODULE.legacyNames]: { legacy_names: ['Fission Casing'] },
      },
    };
    const element: NCPFElement = makeElement(raw);
    expect(element.displayName).toBe('裂变外壳');
    expect(element.canonicalName).toBe('裂变外壳');

    const sfr = project.getConfiguration('nuclearcraft:overhaul_sfr')!;
    const localized = sfr.blocks.map((b) => (b === sfr.blocks[0] ? element : b));
    // The configured (English) name still resolves: localization never breaks matching.
    expect(findElementByName(localized, 'nuclearcraft:fission_casing')?.definition.name).toBe(
      'nuclearcraft:fission_casing',
    );
  });

  it('reads a heat sink rule target as a module reference', () => {
    const sfr = project.getConfiguration('nuclearcraft:overhaul_sfr')!;
    const sinks = sfr.blocks.filter((b) => moduleOf(b, 'nuclearcraft:overhaul_sfr:heat_sink'));
    expect(sinks.length).toBeGreaterThan(0);
    const withRules = sinks.filter((s) => {
      const m = moduleOf(s, 'nuclearcraft:overhaul_sfr:heat_sink');
      return Array.isArray(m?.rules) && (m.rules as unknown[]).length > 0;
    });
    expect(withRules.length).toBeGreaterThan(0);
  });
});
