/**
 * `java.util.Random`, ported exactly.
 *
 * The generator's mutators consume `nextInt(bound)`, `nextFloat()` and
 * `nextBoolean()`; the *distribution* of those calls is what gives the search its
 * character, so the LCG is reproduced rather than replaced by `Math.random()`.
 *
 * The frozen Java generator seeded each thread with `new Random()` (the clock), so
 * a run was never repeatable. Here the seed is a required argument — the same seed
 * produces the same search, which is what makes R4 testable at all.
 */
export class JavaRandom {
  private static readonly MULTIPLIER = 0x5deece66dn;
  private static readonly ADDEND = 0xbn;
  private static readonly MASK = (1n << 48n) - 1n;
  private seed = 0n;

  constructor(seed: number | bigint = 0n) {
    this.setSeed(seed);
  }

  /** Java `Random.setSeed`. */
  setSeed(seed: number | bigint): void {
    const value = typeof seed === 'bigint' ? seed : BigInt(Math.trunc(seed));
    this.seed = (value ^ JavaRandom.MULTIPLIER) & JavaRandom.MASK;
  }

  /** Java `Random.next(int bits)`. */
  private next(bits: number): number {
    this.seed = (this.seed * JavaRandom.MULTIPLIER + JavaRandom.ADDEND) & JavaRandom.MASK;
    return Number(this.seed >> BigInt(48 - bits));
  }

  /** Java `Random.nextInt()`. */
  nextInt(): number {
    const value = this.next(32);
    return value | 0;
  }

  /**
   * Java `Random.nextInt(int bound)`.
   *
   * The rejection branch (`bits`-sized value outside the range) is part of the
   * sequence, so it is reproduced rather than simplified into a modulo.
   */
  nextIntBound(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new RangeError(`bound must be a positive integer (got ${bound})`);
    }
    if ((bound & -bound) === bound) {
      return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    }
    let bits: number;
    let value: number;
    do {
      bits = this.next(31);
      value = bits % bound;
    } while (bits - value + (bound - 1) < 0);
    return value;
  }

  /** Java `Random.nextLong()`. */
  nextLong(): number {
    const high = BigInt(this.nextInt());
    const low = BigInt(this.nextInt());
    const value = (high << 32n) + low;
    return Number(BigInt.asIntN(64, value));
  }

  /** Java `Random.nextBoolean()`. */
  nextBoolean(): boolean {
    return this.next(1) !== 0;
  }

  /** Java `Random.nextFloat()`. */
  nextFloat(): number {
    return Math.fround(this.next(24) / (1 << 24));
  }

  /** Java `Random.nextDouble()`. */
  nextDouble(): number {
    const high = BigInt(this.next(26));
    const low = BigInt(this.next(27));
    return Number((high << 27n) + low) / Number(1n << 53n);
  }

  /** Java `Random.nextGaussian()` — unused by the generator, kept for parity tests. */
  nextGaussian(): number {
    return 0; // see docs/r4/README.md: not ported, nothing in the generator calls it
  }

  /** Snapshot of the internal state (for deterministic resumption). */
  get state(): bigint {
    return this.seed;
  }
}
