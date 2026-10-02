/**
 * The `plannerator:generator_settings` NCPF module — the generator's storage shape.
 *
 * ```json
 * { "settings": { "name": "Output", "stages": [ … ], "parameters": [ … ] } }
 * ```
 *
 * Java modelled this as an NCPF module so a `.ncpf.json` project could carry a
 * generator; the module name and the inner shape are wire format. The reader here is
 * tolerant where the Java reader was strict (R1's rule: the TypeScript reader
 * accepts what the frozen Java reader would throw on), and the writer emits exactly
 * the Java key set.
 */

import type { JsonObject } from './json.js';
import { isJsonObject, objectOf } from './json.js';
import type { VariableResolver } from './expression.js';
import type { GeneratorGrid } from './grid.js';
import { generatorFromJson, LiteGenerator } from './generator.js';

/** Java `GeneratorSettingsModule.name`. */
export const GENERATOR_SETTINGS_MODULE = 'plannerator:generator_settings';

/** The subtree a `.ncpf.json` carries at `modules[GENERATOR_SETTINGS_MODULE]`. */
export function readGeneratorSettings(
  module: unknown,
  resolver: VariableResolver,
): LiteGenerator<never> | null {
  if (!isJsonObject(module)) return null;
  const settings = objectOf(module.settings);
  if (Object.keys(settings).length === 0) return null;
  return generatorFromJson(settings, resolver) as LiteGenerator<never>;
}

/** The `modules` entry a `.ncpf.json` should carry. */
export function writeGeneratorSettings(
  generator: LiteGenerator<never>,
  resolver: VariableResolver,
): JsonObject {
  return { [GENERATOR_SETTINGS_MODULE]: { settings: generator.toJson(resolver) } };
}

/** Convenience: read from a whole project object's `modules` map. */
export function readGeneratorFromProject(
  project: unknown,
  resolver: VariableResolver,
): LiteGenerator<never> | null {
  const modules = objectOf(objectOf(project).modules);
  return readGeneratorSettings(modules[GENERATOR_SETTINGS_MODULE], resolver);
}

/** Re-exported so `ncpf.ts` is usable without reaching into `generator.js`. */
export type { GeneratorGrid };
