/**
 * `variable/**` of the frozen generator — the read-only values a generator
 * expression may reference.
 *
 * Java models these as an abstract class per numeric width (`VariableInt`,
 * `VariableFloat`, `VariableLong`, `VariableBoolean`, `VariableString`) because it
 * needs the Java type for casting; here a variable is just a name plus a thunk,
 * and the numeric width travels as metadata (`kind`) so that
 * `SettingVariable<Number>` conversions stay explicit.
 */

export type VariableKind = 'int' | 'float' | 'long' | 'boolean' | 'string' | 'object';

export interface Variable<T = unknown> {
  readonly name: string;
  get(): T;
}

/**
 * The covariant read view (see `AnySetting` in `setting.ts`).
 *
 * `TypedVariable<T>` is invariant through `get(): T` only in the return position, so
 * it is already covariant — but a registry that must hold a `Setting<number>` and a
 * `Setting<boolean>` together cannot name a common `T` without a cast unless the
 * read type is erased to `unknown`. `AnyVariable` is that erased view.
 */
export type AnyVariable = Variable<unknown>;

export interface TypedVariable<T = unknown> extends Variable<T> {
  readonly kind: VariableKind;
}

/** Erase the read type — the only cast needed for heterogeneous registries. */
export function asAnyVariable<T>(variable: Variable<T>): AnyVariable {
  return variable;
}

function make<T>(kind: VariableKind, name: string, read: () => T): TypedVariable<T> {
  return { kind, name, get: read };
}

/** Java `VariableInt`. */
export function intVariable(name: string, read: () => number): TypedVariable<number> {
  return make('int', name, read);
}

/** Java `VariableFloat`. */
export function floatVariable(name: string, read: () => number): TypedVariable<number> {
  return make('float', name, read);
}

/** Java `VariableLong`. */
export function longVariable(name: string, read: () => number): TypedVariable<number> {
  return make('long', name, read);
}

/** Java `VariableBoolean`. */
export function booleanVariable(name: string, read: () => boolean): TypedVariable<boolean> {
  return make('boolean', name, read);
}

/** Java `VariableString`. */
export function stringVariable(name: string, read: () => string): TypedVariable<string> {
  return make('string', name, read);
}

/**
 * Java `VariableNull` — the empty value a `ConditionEqual`/`ConditionNotEqual`
 * starts with (`BiCondition(…, VariableNull::new)`).
 */
export function nullVariable(): TypedVariable<null> {
  return make('object', 'null', () => null);
}

/** Java `Number.doubleValue()` for whatever a variable holds. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/** Java `floatValue()`. */
export function toFloat(value: unknown): number {
  return Math.fround(toNumber(value));
}

/** Java `intValue()`. */
export function toInt(value: unknown): number {
  return Math.trunc(toNumber(value));
}
