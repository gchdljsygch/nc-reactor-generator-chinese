/**
 * Java-compatible numeric helpers.
 *
 * The golden dataset was produced by the frozen Java editor engine, whose
 * intermediate results are `float` (`totalOutput`, `efficiency`,
 * `coolingPenaltyMult`, …). Reproducing those values requires reproducing
 * *float rounding at every step*, not just at the end: `float a = b*c*d` in Java
 * rounds twice, so computing in `number` and rounding once gives different
 * results.
 *
 * Every arithmetic operation that Java performs in `float` must therefore go
 * through one of these helpers. `@see docs/r1/float-fidelity.md`.
 */

/** Round to the nearest IEEE-754 single. */
export const f = Math.fround;

export const fadd = (a: number, b: number): number => Math.fround(a + b);
export const fsub = (a: number, b: number): number => Math.fround(a - b);
export const fmul = (a: number, b: number): number => Math.fround(a * b);
export const fdiv = (a: number, b: number): number => Math.fround(a / b);

/**
 * Java narrowing conversion `int += float`: the sum is computed in `float` by
 * the compound assignment, then narrowed to `int` (round toward zero, saturating
 * at the `int` bounds).
 */
export function intAccumulateFloat(intValue: number, floatValue: number): number {
  const sum = Math.fround(intValue + floatValue);
  return f2i(sum);
}

/** Java narrowing `float` → `int` (round toward zero, saturate). */
export function f2i(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v >= 2147483647) return 2147483647;
  if (v <= -2147483648) return -2147483648;
  return Math.trunc(v);
}

/** Java `(float)` cast of a double expression. */
export const d2f = Math.fround;

/** Java `MathUtil.exp` — `Math.exp` on a double. */
export const jexp = Math.exp;
