import type {
  DeferredSink,
  Expression,
  VariableResolver,
  SettingVariable as SettingVariableType,
} from './expression.js';
import { ConstInt, SettingVariable } from './expression.js';
import type { JsonObject } from './json.js';
import { objectsOf, stringOf } from './json.js';
import type { AnySetting } from './setting.js';
import { expressionSetting, SettingCondition, SettingConditionList } from './setting.js';
import { longVariable, nullVariable, toNumber, type Variable } from './variable.js';

/**
 * `condition/**` — the gate in front of every mutator, priority and stage
 * transition.
 *
 * Ported one-for-one, including where the `Hits` counters are incremented (the
 * *caller* bumps a condition's own counter, while the composite conditions bump
 * their children) because those counters are addressable variables — a generator
 * can branch on "how many times has this condition been reached", which is how the
 * shipped presets drive their stage machine.
 */

export interface Condition {
  readonly conditionType: string;
  readonly title: string;
  hits: number;
  reset(): void;
  check(): boolean;
  settings(): readonly AnySetting[];
  /** Java `getAllVariables(vars, names, prevPath)`. */
  collectVariables(prefix: string, out: { path: string; variable: Variable }[]): void;
  toJson(resolver: VariableResolver): JsonObject;
}

export type { DeferredSink };

abstract class BaseCondition implements Condition {
  hits = 0;
  protected readonly hitsVariable = longVariable('Hits', () => this.hits);

  abstract readonly conditionType: string;
  abstract readonly title: string;

  reset(): void {
    this.hits = 0;
  }

  abstract check(): boolean;

  settings(): readonly AnySetting[] {
    return [];
  }

  collectVariables(prefix: string, out: { path: string; variable: Variable }[]): void {
    out.push({ path: `${prefix}.Hits`, variable: this.hitsVariable });
  }

  /** Java's `RegisteredNCPFObject.type` written last by the list serializer. */
  toJson(resolver: VariableResolver): JsonObject {
    return { ...this.bodyJson(resolver), type: this.conditionType };
  }

  protected bodyJson(_resolver: VariableResolver): JsonObject {
    return {};
  }
}

/** Java `BiCondition` — two expression slots and no body of its own. */
abstract class BiCondition extends BaseCondition {
  v1: SettingVariable;
  v2: SettingVariable;

  protected constructor(
    v1: SettingVariable,
    v2: SettingVariable,
  ) {
    super();
    this.v1 = v1;
    this.v2 = v2;
  }

  override settings(): readonly AnySetting[] {
    return [
      expressionSetting(
        'Value 1',
        () => this.v1.value,
        (value: Expression) => this.v1.set(value),
      ),
      expressionSetting(
        'Value 2',
        () => this.v2.value,
        (value: Expression) => this.v2.set(value),
      ),
    ];
  }

  protected override bodyJson(resolver: VariableResolver): JsonObject {
    return { v1: this.v1.toJson(resolver), v2: this.v2.toJson(resolver) };
  }

  /** Java `convertFromObject`, reachable from the registry below. */
  load(json: JsonObject, resolver: VariableResolver, sink?: DeferredSink): void {
    this.v1 = SettingVariable.fromJson((json.v1 ?? {}) as JsonObject, resolver, sink);
    this.v2 = SettingVariable.fromJson((json.v2 ?? {}) as JsonObject, resolver, sink);
  }
}

/** Java's `SettingVariable(Integer)` starting on the `VariableNull` sentinel. */
function nullSetting(): SettingVariable {
  return new SettingVariable(null, nullVariable() as Expression);
}

/** Java's `SettingVariable(Integer)` starting on a `ConstInt`. */
function intSetting(value: number): SettingVariable {
  return new SettingVariable(null, new ConstInt(value));
}

/** Java `ConditionEqual` — `Objects.equals`. */
export class ConditionEqual extends BiCondition {
  readonly conditionType = 'equal';
  readonly title = 'Equal';

  constructor() {
    super(nullSetting(), nullSetting());
  }

  check(): boolean {
    return javaEquals(this.v1.get(), this.v2.get());
  }
}

/** Java `ConditionNotEqual`. */
export class ConditionNotEqual extends BiCondition {
  readonly conditionType = 'not_equal';
  readonly title = 'Not Equal';

  constructor() {
    super(nullSetting(), nullSetting());
  }

  check(): boolean {
    return !javaEquals(this.v1.get(), this.v2.get());
  }
}

/**
 * `Objects.equals` for the values this language can hold.
 *
 * Java's boxed-number equality is *type sensitive* (`Integer(1) != Float(1)`);
 * `Object.is` reproduces the observable cases here (and treats `NaN == NaN`, which
 * `Float.equals` also does — a NaN comparison in Java is `true`, unlike `==`).
 */
function javaEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  return a === b;
}

/** Java `ConditionGreater`. */
export class ConditionGreater extends BiCondition {
  readonly conditionType = 'greater';
  readonly title = 'Greater';

  constructor() {
    super(intSetting(0), intSetting(0));
  }

  check(): boolean {
    return toNumber(this.v1.get()) > toNumber(this.v2.get());
  }
}

/** Java `ConditionGreaterEqual`. */
export class ConditionGreaterEqual extends BiCondition {
  readonly conditionType = 'greater_or_equal';
  readonly title = 'Greater or Equal';

  constructor() {
    super(intSetting(0), intSetting(0));
  }

  check(): boolean {
    return toNumber(this.v1.get()) >= toNumber(this.v2.get());
  }
}

/** Java `ConditionLess`. */
export class ConditionLess extends BiCondition {
  readonly conditionType = 'less';
  readonly title = 'Less';

  constructor() {
    super(intSetting(0), intSetting(0));
  }

  check(): boolean {
    return toNumber(this.v1.get()) < toNumber(this.v2.get());
  }
}

/** Java `ConditionLessEqual`. */
export class ConditionLessEqual extends BiCondition {
  readonly conditionType = 'less_or_equal';
  readonly title = 'Less or Equal';

  constructor() {
    super(intSetting(0), intSetting(0));
  }

  check(): boolean {
    return toNumber(this.v1.get()) <= toNumber(this.v2.get());
  }
}

/** Java `ConditionAnd`. */
export class ConditionAnd extends BaseCondition {
  readonly conditionType = 'and';
  readonly title = 'And';
  readonly conditions = new SettingConditionList(null, []);

  check(): boolean {
    for (const condition of this.conditions.get()) {
      condition.hits++;
      if (!condition.check()) return false;
    }
    return true;
  }

  override settings(): readonly AnySetting[] {
    return [this.conditions];
  }

  override collectVariables(prefix: string, out: { path: string; variable: Variable }[]): void {
    super.collectVariables(prefix, out);
    const list = this.conditions.get();
    for (let i = 0; i < list.length; i++) {
      const condition = list[i];
      condition.collectVariables(
        `${prefix}.conditions[${i}]{Condition ${i + 1} (${condition.title})}`,
        out,
      );
    }
  }

  override reset(): void {
    super.reset();
    for (const condition of this.conditions.get()) condition.reset();
  }

  protected override bodyJson(resolver: VariableResolver): JsonObject {
    return { conditions: this.conditions.get().map((c) => c.toJson(resolver)) };
  }
}

/** Java `ConditionOr`. */
export class ConditionOr extends BaseCondition {
  readonly conditionType = 'or';
  readonly title = 'Or';
  readonly conditions = new SettingConditionList(null, []);

  check(): boolean {
    for (const condition of this.conditions.get()) {
      condition.hits++;
      if (condition.check()) return true;
    }
    return false;
  }

  override settings(): readonly AnySetting[] {
    return [this.conditions];
  }

  override collectVariables(prefix: string, out: { path: string; variable: Variable }[]): void {
    super.collectVariables(prefix, out);
    const list = this.conditions.get();
    for (let i = 0; i < list.length; i++) {
      const condition = list[i];
      condition.collectVariables(
        `${prefix}.conditions[${i}]{Condition ${i + 1} (${condition.title})}`,
        out,
      );
    }
  }

  override reset(): void {
    super.reset();
    for (const condition of this.conditions.get()) condition.reset();
  }

  protected override bodyJson(resolver: VariableResolver): JsonObject {
    return { conditions: this.conditions.get().map((c) => c.toJson(resolver)) };
  }
}

/** Java `ConditionNot`. */
export class ConditionNot extends BaseCondition {
  readonly conditionType = 'not';
  readonly title = 'Not';
  readonly condition = new SettingCondition(null, null);

  check(): boolean {
    const inner = this.condition.require();
    inner.hits++;
    return !inner.check();
  }

  override settings(): readonly AnySetting[] {
    return [this.condition];
  }

  override collectVariables(prefix: string, out: { path: string; variable: Variable }[]): void {
    super.collectVariables(prefix, out);
    const inner = this.condition.get();
    if (inner !== null) {
      inner.collectVariables(`${prefix}.condition{Condition (${inner.title})}`, out);
    }
  }

  override reset(): void {
    super.reset();
    this.condition.get()?.reset();
  }

  protected override bodyJson(resolver: VariableResolver): JsonObject {
    const inner = this.condition.get();
    return { condition: inner === null ? null : inner.toJson(resolver) };
  }
}

export const CONDITIONS: ReadonlyMap<string, () => Condition> = new Map<string, () => Condition>([
  ['and', () => new ConditionAnd()],
  ['or', () => new ConditionOr()],
  ['not', () => new ConditionNot()],
  ['equal', () => new ConditionEqual()],
  ['not_equal', () => new ConditionNotEqual()],
  ['greater', () => new ConditionGreater()],
  ['greater_or_equal', () => new ConditionGreaterEqual()],
  ['less', () => new ConditionLess()],
  ['less_or_equal', () => new ConditionLessEqual()],
]);

/** Java `NCPFObject.getRegisteredNCPFList("conditions", Condition.registeredConditions)`. */
export function conditionFromJson(
  json: JsonObject,
  resolver: VariableResolver,
  sink?: DeferredSink,
): Condition {
  const type = stringOf(json.type);
  const factory = CONDITIONS.get(type);
  if (factory === undefined) {
    throw new Error(`failed to load unregistered condition: ${type}`);
  }
  const condition = factory();
  loadCondition(condition, json, resolver, sink);
  return condition;
}

/** Java `NCPFObject.getRegisteredNCPFList`: instantiate by `type`, then convert. */
export function conditionsFromJson(
  value: unknown,
  resolver: VariableResolver,
  sink?: DeferredSink,
): Condition[] {
  return objectsOf(value).map((json) => conditionFromJson(json, resolver, sink));
}

function loadCondition(
  condition: Condition,
  json: JsonObject,
  resolver: VariableResolver,
  sink?: DeferredSink,
): void {
  if (condition instanceof ConditionAnd || condition instanceof ConditionOr) {
    condition.conditions.set(conditionsFromJson(json.conditions, resolver, sink));
    return;
  }
  if (condition instanceof ConditionNot) {
    const inner = json.condition;
    condition.condition.set(
      inner === null || inner === undefined
        ? null
        : conditionFromJson(inner as JsonObject, resolver, sink),
    );
    return;
  }
  if (condition instanceof BiCondition) {
    condition.load(json, resolver, sink);
  }
}

/** Exported for the `not` loader, which needs the abstract type at runtime. */
export { BiCondition as AbstractBiCondition };
export type { SettingVariableType };
