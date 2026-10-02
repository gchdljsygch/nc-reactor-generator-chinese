/**
 * Loading the four shipped generator presets.
 *
 * ## The chicken-and-egg problem, and how Java escaped it
 *
 * A generator's variable expressions reference paths like
 * `multiblock2.Total Output` and `generator.settings.Min Efficiency`. Those paths
 * only exist once you have (a) a grid and (b) the generator itself — but you need the
 * generator *in order to read the file*. Java sidestepped it with a global
 * (`MenuGenerator.current`) plus a `getVariable` that re-resolved by name on every
 * read.
 *
 * This port makes the two-phase structure explicit instead. Every `SettingVariable`
 * the file fills with a variable reference keeps a **deferred** expression whose path
 * is recorded; {@link bindGenerator} then replaces it with the real registry variable
 * once the grid and the generator both exist.
 *
 * ```ts
 * const parsed = parseGeneratorDocument<TGrid>(project);   // no lookups
 * bindGenerator(parsed, { generator, original, priorityMultiblock });
 * ```
 *
 * That is not ceremony: it turns "this preset was written for a different reactor"
 * from a silent `NullPointerException` at iteration 40 000 into a precise error at
 * load time, naming the path the file asked for.
 */

import type { JsonObject } from './json.js';
import { arrayOf, isJsonObject, objectOf, stringOf } from './json.js';
import type { DeferredSink, Expression, VariableResolver } from './expression.js';
import { SettingVariable, resolveVariable } from './expression.js';
import type { GeneratorGrid } from './grid.js';
import { GENERATOR_SETTINGS_MODULE } from './ncpf.js';
import {
  generatorFromJson,
  generatorResolver,
  LiteGenerator,
  type GeneratorVariableContext,
} from './generator.js';

/** One variable reference the file made, and the deferred node standing in for it. */
export interface PendingReference {
  readonly node: Expression;
  readonly path: string;
}

export interface ParsedGenerator<TGrid extends GeneratorGrid<TGrid>> {
  readonly generator: LiteGenerator<TGrid>;
  readonly pending: readonly PendingReference[];
  /** Every path the document referenced, in file order (duplicates kept). */
  readonly referencedPaths: readonly string[];
}

/**
 * Phase 1 — parse a whole `.ncpf.json` project (or a bare `generator_settings`
 * module) into a generator whose variable references are recorded but unresolved.
 *
 * Returns `null` when the document carries no generator settings, which is the normal
 * case for every non-generator project file.
 */
export function parseGeneratorDocument<TGrid extends GeneratorGrid<TGrid>>(
  project: unknown,
): ParsedGenerator<TGrid> | null {
  const root = objectOf(project);
  const modules = objectOf(root.modules);
  const module = isJsonObject(modules[GENERATOR_SETTINGS_MODULE])
    ? objectOf(modules[GENERATOR_SETTINGS_MODULE])
    : root;
  const settings = objectOf(module.settings);
  if (Object.keys(settings).length === 0) return null;

  const nodes: Expression[] = [];
  const byPath = new Map<string, Expression>();
  const sink: DeferredSink = {
    deferred: (path) => {
      // One node per path: every reference to the same variable shares it, so a single
      // patch at bind time fixes every occurrence.
      let node = byPath.get(path);
      if (node === undefined) {
        node = nodeForPath(path);
        byPath.set(path, node);
      }
      nodes.push(node);
      return node;
    },
  };

  // A resolver that never resolves: the sink records every reference, so a lookup that
  // reaches here means a reference escaped the sink, and saying so beats returning
  // `undefined` and failing mysteriously later.
  const resolver: VariableResolver = {
    all: () => [],
    get: (path) => {
      throw new Error(
        `parseGeneratorDocument: '${path}' was resolved instead of deferred — ` +
          'a variable reference escaped the deferred sink',
      );
    },
  };

  const generator = generatorFromJson<TGrid>(settings, resolver, sink) as LiteGenerator<TGrid>;

  const seen = new Set<Expression>();
  const pending: PendingReference[] = [];
  for (const node of nodes) {
    if (seen.has(node)) continue;
    seen.add(node);
    pending.push({ node, path: node.name });
  }
  return { generator, pending, referencedPaths: pending.map((p) => p.path) };
}

/**
 * Phase 2 — resolve every recorded path against the live registry.
 *
 * Throws `unknown generator variable: <path>` (the file's own string, never a mangled
 * internal one) when a document references a variable this reactor does not have.
 * That is the most likely failure when a preset meets the wrong configuration, and it
 * must be diagnosable from the message alone.
 */
export function bindGenerator<TGrid extends GeneratorGrid<TGrid>>(
  parsed: ParsedGenerator<TGrid>,
  context: GeneratorVariableContext<TGrid>,
): LiteGenerator<TGrid> {
  const resolver = generatorResolver(context);
  for (const reference of parsed.pending) {
    const variable = resolveVariable(resolver, reference.path);
    if (variable === undefined) {
      throw new Error(
        `unknown generator variable: ${reference.path} ` +
          `(this preset does not match the reactor it was loaded for; ` +
          `${resolver.all().length} variables are addressable here)`,
      );
    }
    // The deferred node is replaced *in place*: it is a leaf inside the operator tree
    // (`subtract(min(1, multiblock2.X), min(1, multiblock.X))`), not the tree itself.
    // Only the mutable half (`get`) is swapped; `name`/`kind` stay as the file wrote
    // them, which keeps a bound document serializing byte-identically to the file.
    (reference.node as { get: () => unknown }).get = () => variable.get();
  }
  return parsed.generator;
}

/**
 * The deferred node for one path.
 *
 * Reads throw while unbound and `toJson` round-trips the path, so a parsed-but-unbound
 * document serializes back to exactly what was read — which is what the round-trip
 * test asserts.
 */
function nodeForPath(path: string): Expression {
  return {
    expressionType: 'variable',
    kind: 'object' as never,
    name: path,
    get: () => {
      throw new Error(`generator variable "${path}" was never bound`);
    },
    toJson: () => ({ type: 'variable', variable: path }),
  };
}

/** A preset's identifying metadata, read without building the generator. */
export interface PresetInfo {
  readonly path: string;
  readonly name: string;
  readonly settingCount: number;
  readonly stageCount: number;
  readonly stepCount: number;
}

export function describePreset(path: string, project: unknown): PresetInfo {
  const root = objectOf(project);
  const modules = objectOf(root.modules);
  const module = objectOf(modules[GENERATOR_SETTINGS_MODULE]);
  const settings = objectOf(module.settings);
  const stages = arrayOf(settings.stages).filter(isJsonObject);
  let steps = 0;
  for (const stage of stages) steps += arrayOf(stage.steps).length;
  return {
    path,
    name: stringOf(settings.name, 'Custom'),
    settingCount: arrayOf(settings.parameters).length + 1,
    stageCount: stages.length,
    stepCount: steps,
  };
}

export type { JsonObject, SettingVariable };
