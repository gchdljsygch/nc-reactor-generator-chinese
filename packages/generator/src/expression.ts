import type { JsonObject } from './json.js';
import { numberOf, objectOf, stringOf } from './json.js';
import { JavaRandom } from './random.js';
import {
  booleanVariable,
  floatVariable,
  intVariable,
  nullVariable,
  stringVariable,
  toFloat,
  toInt,
  toNumber,
  type TypedVariable,
  type Variable,
  type VariableKind,
} from './variable.js';

/**
 * `variable/constant/**`, `variable/operator/**`, `variable/setting/SettingVariable`
 * and the variable-path registry — the *expression language* half of the frozen
 * generator, in one file because the three parts are mutually recursive
 * (operators hold two `SettingVariable`s, a `SettingVariable` holds an operator).
 *
 * The serialized shape is Java's, verified against the four shipped presets in
 * `datasets/configurations/generators/**`:
 *
 * ```json
 * { "type": "operator", "operator": "subtract",
 *   "v1": { "type": "operator", "operator": "min", "v1": …, "v2": … }, "v2": … }
 * { "type": "constant", "constant": "int", "value": 1 }
 * { "type": "variable", "variable": "multiblock2.Total Output" }
 * ```
 *
 * Two Java mechanisms are replaced on purpose:
 *
 *  - `Constant.registeredConstants` / `Operator.registeredOperators` were filled by
 *    a classpath scan; here they are two literal maps (§4.4d "显式注册替代反射");
 *  - `ConstRandom` used its own unseeded `Random` (so a "random" constant made a run
 *    irreproducible). It reads the ambient run RNG instead — see {@link withRandom}.
 */

/** `null` in Java's `VariableNull`, and the value a missing variable reads as. */
export type ExpressionValue = number | boolean | string | null;

/** Java `MenuGenerator.getAllVariables/getVariableName/getVariable`. */
export interface VariableResolver {
  /** Every addressable variable, in the Java enumeration order. */
  all(): readonly { path: string; variable: Variable }[];
  /**
   * Direct lookup by path, for hot loops.
   *
   * Optional because the two-argument `cloneExpression` fallbacks construct a
   * throwaway resolver; when it is absent, {@link resolveVariable} falls back to the
   * linear scan, which is what Java's `ArrayList.indexOf` did anyway.
   */
  get?(path: string): Variable | undefined;
}

export function resolveVariable(resolver: VariableResolver, path: string): Variable | undefined {
  if (resolver.get !== undefined) return resolver.get(path);
  for (const entry of resolver.all()) if (entry.path === path) return entry.variable;
  return undefined;
}

export function variablePathOf(resolver: VariableResolver, variable: Variable): string | null {
  for (const entry of resolver.all()) if (entry.variable === variable) return entry.path;
  return null;
}

// ---------------------------------------------------------------------------
// ambient RNG (Java's ConstRandom and the mutators both draw from "the run")
// ---------------------------------------------------------------------------

let ambientRandom = new JavaRandom(0);

/** The RNG the current run draws from. */
export function currentRandom(): JavaRandom {
  return ambientRandom;
}

/** Install `random` as the ambient run RNG for the duration of `body`. */
export function withRandom<T>(random: JavaRandom, body: () => T): T {
  const previous = ambientRandom;
  ambientRandom = random;
  try {
    return body();
  } finally {
    ambientRandom = previous;
  }
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export interface Expression<T = ExpressionValue> extends TypedVariable<T> {
  readonly expressionType: 'variable' | 'constant' | 'operator';
  /** Java `SettingVariable.convertToObject` minus the `type`/subtype wrapper. */
  toJson(resolver: VariableResolver): JsonObject;
}

export interface Constant extends Expression {
  readonly expressionType: 'constant';
  readonly constantType: string;
  fromJson(json: JsonObject): void;
}

/** Java `ConstInt`. */
export class ConstInt implements Constant {
  readonly expressionType = 'constant' as const;
  readonly constantType = 'int';
  readonly kind: VariableKind = 'int';
  readonly name = 'Constant';
  value: number;

  constructor(value = 0) {
    this.value = Math.trunc(value);
  }

  get(): number {
    return this.value;
  }

  toJson(): JsonObject {
    return { value: this.value };
  }

  fromJson(json: JsonObject): void {
    this.value = Math.trunc(numberOf(json.value));
  }
}

/** Java `ConstFloat`. */
export class ConstFloat implements Constant {
  readonly expressionType = 'constant' as const;
  readonly constantType = 'float';
  readonly kind: VariableKind = 'float';
  readonly name = 'Constant';
  value: number;

  constructor(value = 0) {
    this.value = Math.fround(value);
  }

  get(): number {
    return this.value;
  }

  toJson(): JsonObject {
    return { value: this.value };
  }

  fromJson(json: JsonObject): void {
    this.value = Math.fround(numberOf(json.value));
  }
}

/**
 * Java `ConstRandom` — `rand.nextFloat()` on every read.
 *
 * Java gave it a private unseeded `Random`, so anything that used it was
 * irreproducible; this reads {@link currentRandom}, which the driver seeds.
 */
export class ConstRandom implements Constant {
  readonly expressionType = 'constant' as const;
  readonly constantType = 'random';
  readonly kind: VariableKind = 'float';
  readonly name = 'Random';

  get(): number {
    return currentRandom().nextFloat();
  }

  toJson(): JsonObject {
    return {};
  }

  fromJson(): void {
    // no fields
  }
}

export const CONSTANTS: ReadonlyMap<string, () => Constant> = new Map<string, () => Constant>([
  ['int', () => new ConstInt()],
  ['float', () => new ConstFloat()],
  ['random', () => new ConstRandom()],
]);

// ---------------------------------------------------------------------------
// operators
// ---------------------------------------------------------------------------

export interface OperatorValue extends Expression {
  readonly expressionType: 'operator';
  readonly operatorType: string;
  fromJson(json: JsonObject, resolver: VariableResolver, sink?: DeferredSink): void;
}

/**
 * `SettingVariable<T>` — "a value the user picks", i.e. a variable slot that may
 * hold a variable, a constant or an operator.
 */
export class SettingVariable {
  value: Expression;

  constructor(
    public name: string | null,
    value: Expression,
  ) {
    this.value = value;
  }

  get(): ExpressionValue {
    return this.value.get() as ExpressionValue;
  }

  set(value: Expression): void {
    this.value = value;
  }

  toJson(resolver: VariableResolver): JsonObject {
    const value = this.value;
    if (value.expressionType === 'operator') {
      return {
        ...value.toJson(resolver),
        type: 'operator',
        operator: (value as OperatorValue).operatorType,
      };
    }
    if (value.expressionType === 'constant') {
      return {
        ...value.toJson(resolver),
        type: 'constant',
        constant: (value as Constant).constantType,
      };
    }
    // A reference the resolver cannot name is either a deferred (not yet bound)
    // variable — which remembers its own path — or a genuinely unknown one; both
    // serialize through the expression itself.
    const path = variablePathOf(resolver, value);
    if (path === null) return value.toJson(resolver);
    return { type: 'variable', variable: path };
  }

  static fromJson(
    json: JsonObject,
    resolver: VariableResolver,
    sink?: DeferredSink,
  ): SettingVariable {
    return new SettingVariable(null, expressionFromJson(json, resolver, sink));
  }

  copy(): SettingVariable {
    return new SettingVariable(this.name, cloneExpression(this.value));
  }
}

/** Java `SettingVariable.convertFromObject`. */
export interface DeferredSink {
  /**
   * Called once per variable reference the document makes, in file order.
   *
   * It returns the node the expression tree must actually use. Returning the *same*
   * object the caller records is what makes a later `bind` possible: a node invented
   * by the sink and a node invented here would be two different objects, and patching
   * one would leave the other throwing.
   */
  deferred(path: string): Expression;
}

export function expressionFromJson(
  json: JsonObject,
  resolver: VariableResolver,
  /** When given, a variable reference is recorded instead of resolved. */
  sink?: DeferredSink,
): Expression {
  const type = stringOf(json.type);
  const subtype = stringOf(json[type]);
  switch (type) {
    case 'constant': {
      const factory = CONSTANTS.get(subtype);
      if (factory === undefined) {
        throw new Error(`failed to load unregistered constant: ${subtype}`);
      }
      const constant = factory();
      constant.fromJson(json);
      return constant;
    }
    case 'operator': {
      const factory = OPERATORS.get(subtype);
      if (factory === undefined) {
        throw new Error(`failed to load unregistered operator: ${subtype}`);
      }
      const operator = factory();
      operator.fromJson(json, resolver, sink);
      return operator;
    }
    case 'variable': {
      if (sink !== undefined) {
        // Deferred load: the caller (`presets.ts`) resolves this once the grid and the
        // generator both exist. The node it returns goes into the tree verbatim.
        return sink.deferred(subtype);
      }
      const variable = resolveVariable(resolver, subtype);
      if (variable === undefined) {
        throw new Error(`failed to load invalid variable: ${subtype}`);
      }
      return asExpression(variable);
    }
    default:
      throw new Error(`unknown variable type: ${type}`);
  }
}

/**
 * A variable reference whose target is not known yet.
 *
 * Reads throw with the path in the message; \`toJson\` round-trips the path, so a
 * parsed-but-unbound document can still be written back out byte-identically.
 */
export function deferredVariable(path: string): Expression {
  return {
    expressionType: 'variable',
    kind: 'object',
    name: path,
    get: () => {
      throw new Error(`generator variable "${path}" was never bound`);
    },
    toJson: () => ({ type: 'variable', variable: path }),
  };
}

/** Wrap a plain registry variable as an expression node. */
function asExpression(variable: Variable): Expression {
  const typed = variable as TypedVariable;
  return {
    expressionType: 'variable',
    kind: typed.kind ?? 'object',
    name: typed.name,
    get: () => typed.get() as ExpressionValue,
    toJson: () => {
      throw new Error('a bare variable needs a resolver to serialize');
    },
  };
}

function cloneExpression(expression: Expression): Expression {
  if (expression.expressionType === 'constant') {
    const constant = expression as Constant;
    const json = constant.toJson({ all: () => [] });
    const clone = (CONSTANTS.get(constant.constantType) as () => Constant)();
    clone.fromJson(json);
    return clone;
  }
  if (expression.expressionType === 'operator') {
    const operator = expression as OperatorValue;
    const json = operator.toJson({ all: () => [] });
    const clone = (OPERATORS.get(operator.operatorType) as () => OperatorValue)();
    clone.fromJson(json, { all: () => [] });
    return clone;
  }
  // A registry variable is read-only and shared: cloning it would break the
  // identity `variablePathOf` relies on when serializing.
  return expression;
}

interface BinaryParts {
  v1: SettingVariable;
  v2: SettingVariable;
}

/** Java `BiFloatOperator` — two operands, result is a `float`. */
export abstract class BiFloatOperator implements OperatorValue, BinaryParts {
  readonly expressionType = 'operator' as const;
  readonly kind: VariableKind = 'float';
  v1: SettingVariable;
  v2: SettingVariable;

  protected constructor(
    readonly operatorType: string,
    readonly name: string,
    v1: Expression = new ConstInt(0),
    v2: Expression = new ConstInt(0),
  ) {
    this.v1 = new SettingVariable(null, v1);
    this.v2 = new SettingVariable(null, v2);
  }

  abstract compute(a: number, b: number): number;

  get(): number {
    return Math.fround(this.compute(toFloat(this.v1.get()), toFloat(this.v2.get())));
  }

  toJson(resolver: VariableResolver): JsonObject {
    return { v1: this.v1.toJson(resolver), v2: this.v2.toJson(resolver) };
  }

  fromJson(json: JsonObject, resolver: VariableResolver, sink?: DeferredSink): void {
    // The sink must reach the operands: a priority's operator *is* an operator tree,
    // so a variable reference is always a leaf several levels down, never the root.
    this.v1 = SettingVariable.fromJson(objectOf(json.v1), resolver, sink);
    this.v2 = SettingVariable.fromJson(objectOf(json.v2), resolver, sink);
  }
}

export class OperatorAddition extends BiFloatOperator {
  constructor() {
    super('add', 'Add');
  }
  override compute(a: number, b: number): number {
    return a + b;
  }
}

export class OperatorSubtraction extends BiFloatOperator {
  constructor() {
    super('subtract', 'Subtract');
  }
  override compute(a: number, b: number): number {
    return a - b;
  }
}

export class OperatorMultiplication extends BiFloatOperator {
  constructor() {
    super('multiply', 'Multiply');
  }
  override compute(a: number, b: number): number {
    return a * b;
  }
}

export class OperatorDivision extends BiFloatOperator {
  constructor() {
    super('divide', 'Divide');
  }
  override compute(a: number, b: number): number {
    return a / b;
  }
}

export class OperatorMinimum extends BiFloatOperator {
  constructor() {
    super('min', 'Minimum');
  }
  override compute(a: number, b: number): number {
    return Math.min(a, b);
  }
}

export class OperatorMaximum extends BiFloatOperator {
  constructor() {
    super('max', 'Maximum');
  }
  override compute(a: number, b: number): number {
    return Math.max(a, b);
  }
}

/** Java `OperatorFloor` — one operand, result is an `int`. */
export class OperatorFloor implements OperatorValue {
  readonly expressionType = 'operator' as const;
  readonly operatorType = 'floor';
  readonly kind: VariableKind = 'int';
  readonly name = 'Floor';
  v: SettingVariable;

  constructor(v: Expression = new ConstInt(0)) {
    this.v = new SettingVariable(null, v);
  }

  get(): number {
    return toInt(this.v.get());
  }

  toJson(resolver: VariableResolver): JsonObject {
    return { v: this.v.toJson(resolver) };
  }

  fromJson(json: JsonObject, resolver: VariableResolver): void {
    this.v = SettingVariable.fromJson(objectOf(json.v), resolver);
  }
}

export const OPERATORS: ReadonlyMap<string, () => OperatorValue> = new Map<string, () => OperatorValue>([
  ['add', () => new OperatorAddition()],
  ['subtract', () => new OperatorSubtraction()],
  ['multiply', () => new OperatorMultiplication()],
  ['divide', () => new OperatorDivision()],
  ['min', () => new OperatorMinimum()],
  ['max', () => new OperatorMaximum()],
  ['floor', () => new OperatorFloor()],
]);

// ---------------------------------------------------------------------------
// variable factories (so a caller can build a registry without re-importing)
// ---------------------------------------------------------------------------

export const variables = {
  int: intVariable,
  float: floatVariable,
  boolean: booleanVariable,
  string: stringVariable,
  null: nullVariable,
  toNumber,
  toFloat,
  toInt,
};
