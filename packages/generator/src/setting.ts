import { Symmetry } from './symmetry.js';
import type { Condition } from './condition.js';
import type { Expression, VariableResolver } from './expression.js';
import type { JsonObject } from './json.js';
import { booleanOf, numberOf, stringOf } from './json.js';
import {
  floatVariable,
  intVariable,
  type TypedVariable,
  type Variable,
  type VariableKind,
} from './variable.js';

/**
 * `variable/setting/**` — the *parameters* a generator exposes and the little
 * structural settings (index lists, symmetry, conditions) that hang off a stage.
 *
 * Java splits these across nine classes and a registry
 * (`Parameter.registeredParameters`). The four scalar parameters keep the Java
 * `type` names (`int`, `float`, `percent`, `boolean`) because they are written into
 * the shipped preset JSON and read back by the registry.
 *
 * **`percent` stores a fraction, not a percentage.** `SettingPercent.addSettings`
 * displays `value * 100` and parses `/100`, so the shipped presets' `"value": 4.0`
 * renders as `400%` in the Java UI — a quirk of the frozen data, faithfully
 * preserved here (the priority that uses it then reads `min(4.0, efficiency) =
 * efficiency`, i.e. the default imposes no constraint). `docs/r4/README.md`
 * records this; changing it would silently change what the shipped presets mean.
 */

export type SettingKind =
  | 'int'
  | 'float'
  | 'percent'
  | 'boolean'
  | 'string'
  | 'indicies'
  | 'symmetry'
  | 'condition'
  | 'conditionList'
  | 'expression';

export interface Setting<T = unknown> extends TypedVariable<T> {
  readonly settingKind: SettingKind;
  set(value: T): void;
}

/**
 * The covariant view of a {@link Setting}.
 *
 * A setting registry must hold `Setting<number>`, `Setting<boolean>` and
 * `Setting<string>` side by side. `Setting<T>` is invariant — `set(value: T)` puts
 * `T` in a parameter position — so `Setting<boolean>` is not assignable to
 * `Setting<unknown>`, and a heterogeneous list of them does not typecheck.
 *
 * Every consumer in this package only ever *reads* a setting (the UI's writer is the
 * app's own code, which addresses one setting at a time by name). So read positions
 * are typed as `AnySetting`, which is precisely the read-only projection:
 *
 * ```ts
 * interface AnySetting extends Variable<unknown> { readonly settingKind: SettingKind; }
 * ```
 *
 * Writes go through {@link setSetting}, the single place that has to admit the
 * cast, instead of scattering `as unknown as Setting<…>` over every call site.
 */
export interface AnySetting extends Variable<unknown> {
  readonly settingKind: SettingKind;
}

export function asAnySetting<T>(setting: Setting<T>): AnySetting {
  return setting;
}

/** Write a setting from a heterogeneous registry. The cast is confined here. */
export function setSetting(setting: AnySetting, value: unknown): void {
  (setting as unknown as Setting<unknown>).set(value);
}

/** A `ThingWithSettings` (Java interface of the same name). */
export interface ThingWithSettings {
  readonly settingsPrefix: string;
  settings(): readonly AnySetting[];
}

// ---------------------------------------------------------------------------
// scalar parameters
// ---------------------------------------------------------------------------

export interface Parameter<T = unknown> extends Setting<T> {
  readonly parameterType: string;
  toJson(): JsonObject;
}

abstract class ScalarParameter<T> implements Parameter<T> {
  abstract readonly parameterType: string;
  abstract readonly kind: TypedVariable<T>['kind'];
  /** See {@link Setting} — the heterogeneous-registry reader. */
  abstract readonly settingKind: SettingKind;
  protected value: T;

  constructor(
    public name: string,
    value: T,
  ) {
    this.value = value;
  }

  get(): T {
    return this.value;
  }

  set(value: T): void {
    this.value = value;
  }

  abstract coerce(value: unknown): T;

  toJson(): JsonObject {
    // Java writes `name` + `value`; the registry supplies `type`.
    return { name: this.name, value: this.value as unknown as JsonObject[string] };
  }

  fromJson(json: JsonObject): void {
    this.name = stringOf(json.name, this.name);
    this.value = this.coerce(json.value);
  }
}

/** Java `SettingInt` (`type: "int"`). */
export class SettingInt extends ScalarParameter<number> {
  readonly parameterType = 'int';
  readonly settingKind = 'int' as const;
  readonly kind = 'int' as const;

  constructor(name = '', value = 0) {
    super(name, Math.trunc(value));
  }

  coerce(value: unknown): number {
    return Math.trunc(numberOf(value));
  }

  override get(): number {
    return super.get();
  }
}

/** Java `SettingFloat` (`type: "float"`). */
export class SettingFloat extends ScalarParameter<number> {
  readonly parameterType = 'float';
  readonly settingKind = 'float' as const;
  readonly kind = 'float' as const;

  constructor(name = '', value = 0) {
    super(name, Math.fround(value));
  }

  coerce(value: unknown): number {
    return Math.fround(numberOf(value));
  }
}

/** Java `SettingPercent` (`type: "percent"`) — the stored value is a fraction. */
export class SettingPercent extends ScalarParameter<number> {
  readonly parameterType = 'percent';
  readonly settingKind = 'percent' as const;
  readonly kind = 'float' as const;

  constructor(name = '', value = 0) {
    super(name, Math.fround(value));
  }

  coerce(value: unknown): number {
    return Math.fround(numberOf(value));
  }
}

/** Java `SettingBoolean` (`type: "boolean"`). */
export class SettingBoolean extends ScalarParameter<boolean> {
  readonly parameterType = 'boolean';
  readonly settingKind = 'boolean' as const;
  readonly kind = 'boolean' as const;
  allowSliding = false;

  constructor(name = '', value = false) {
    super(name, value);
  }

  coerce(value: unknown): boolean {
    return booleanOf(value);
  }
}

export const PARAMETERS: ReadonlyMap<string, () => Parameter> = new Map<string, () => Parameter>([
  ['int', () => new SettingInt()],
  ['float', () => new SettingFloat()],
  ['percent', () => new SettingPercent()],
  ['boolean', () => new SettingBoolean()],
]);

/** Java `NCPFObject.getRegisteredNCPFList("parameters", Parameter.registeredParameters)`. */
export function parameterFromJson(json: JsonObject): Parameter {
  const type = stringOf(json.type);
  const factory = PARAMETERS.get(type);
  if (factory === undefined) {
    throw new Error(`failed to load unregistered parameter: ${type}`);
  }
  const parameter = factory();
  (parameter as unknown as ScalarParameter<unknown>).fromJson(json);
  return parameter;
}

/**
 * Java `SettingString` — only ever the generator's own `name` field. It is not a
 * registered `Parameter` (a user cannot add one), so it has no `type` key.
 */
export class SettingString implements Setting<string> {
  readonly settingKind = 'string' as const;
  readonly kind = 'string' as const;

  constructor(
    public name: string,
    private value: string,
  ) {}

  get(): string {
    return this.value;
  }

  set(value: string): void {
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// structural settings
// ---------------------------------------------------------------------------

/**
 * Java `SettingIndicies` — a set of block/fuel/recipe indices, edited as toggles.
 *
 * `init` mirrors Java: when `airLabel` is given the label list gets "Air" prepended
 * (so the UI can offer "erase"), while the stored values keep their own numbering.
 * That asymmetry is Java's (`RandomBlockMutator` subtracts 1, `RandomCellMutator`
 * does not); both behaviours are reproduced.
 */
export class SettingIndicies implements Setting<number[]> {
  readonly settingKind = 'indicies' as const;
  readonly kind = 'object' as const;
  names: readonly string[] = [];
  private value: number[] = [];

  constructor(public name: string) {}

  get(): number[] {
    return this.value;
  }

  set(value: number[]): void {
    this.value = [...value];
  }

  init(names: readonly string[], airLabel: string | null = null): void {
    this.names = airLabel === null ? [...names] : [airLabel, ...names];
  }

  toJson(): number[] {
    return [...this.value];
  }
}

/** Java `SettingSymmetry`. */
export class SettingSymmetry implements Setting<Symmetry> {
  readonly settingKind = 'symmetry' as const;
  readonly kind = 'object' as const;
  readonly name = 'Symmetry';

  constructor(private value: Symmetry = new Symmetry()) {}

  get(): Symmetry {
    return this.value;
  }

  set(value: Symmetry): void {
    this.value = value;
  }
}

/** Java `SettingCondition` — a single nested condition (used by `ConditionNot`). */
export class SettingCondition implements Setting<Condition | null>, Setting<unknown> {
  readonly settingKind = 'condition' as const;
  readonly kind: VariableKind = 'object';
  /** Java's name is nullable; the shared `Variable` shape is not. */
  readonly name: string;

  constructor(
    name: string | null,
    private value: Condition | null = null,
  ) {
    this.name = name ?? '';
  }

  get(): Condition | null {
    return this.value;
  }

  /** See `AnySetting`: the registry view proves the read direction only. */
  read(): unknown {
    return this.value;
  }

  set(value: Condition | null): void {
    this.value = value;
  }

  /** Java's `SettingCondition.addSettings` assumes non-null; so does the caller. */
  require(): Condition {
    if (this.value === null) throw new Error('condition setting is empty');
    return this.value;
  }
}

/** Java `SettingConditionList`. */
export class SettingConditionList implements Setting<Condition[]>, Setting<unknown> {
  readonly settingKind = 'conditionList' as const;
  readonly kind: VariableKind = 'object';
  /** Java's name is nullable; the shared `Variable` shape is not. */
  readonly name: string;

  constructor(
    name: string | null,
    private value: Condition[] = [],
  ) {
    this.name = name ?? '';
  }

  get(): Condition[] {
    return this.value;
  }

  set(value: Condition[]): void {
    this.value = value;
  }
}

/** A `SettingVariable` seen through the structural-`Setting` interface. */
export function expressionSetting(
  name: string | null,
  get: () => Expression,
  set: (value: Expression) => void,
): Setting<Expression> & { resolve(resolver: VariableResolver): JsonObject } {
  return {
    settingKind: 'expression',
    kind: 'object',
    name: name ?? '',
    get,
    set,
    resolve: (resolver) => get().toJson(resolver),
  };
}

export const variableFactories = {
  int: intVariable,
  float: floatVariable,
};
