/**
 * `anim/**` — the generator's animated preview.
 *
 * The frozen Java kept a queue of animations for multiblocks the generator had
 * stored or improved, so the configuration menu could cycle through recent results
 * while the search kept running. It is *presentation only*: nothing in the search
 * reads it.
 *
 * This port keeps the one part that is real behaviour — the bounded history of
 * recently produced grids and the "which one is on screen" cursor, advanced on a
 * timer — and drops the rendering (`plannerator.anim.Animation` was a Java2D
 * tweening system). What is left is what a UI needs: a snapshot ring, a frame
 * counter, and a notification when the cursor moves.
 *
 * Deliberate divergence, recorded in `docs/r4/README.md`: the Java preview rotated a
 * grid by mutating it (`MenuGenerator.nextAnim` calls `multiblock.rotate()`), so
 * *watching* a result could change it. Nothing here mutates a stored grid.
 */

import type { GeneratorGrid } from './grid.js';

export interface AnimFrame {
  /** Monotonic id, so a consumer can tell two identical grids apart. */
  readonly id: number;
  readonly tooltip: string;
  /** Milliseconds of wall time this frame is shown for. */
  readonly durationMs: number;
}

export interface AnimOptions {
  /** How many recent frames to keep. Java kept the whole run's history. */
  readonly history?: number;
  /** Frames per stored grid. */
  readonly framesPerGrid?: number;
  readonly frameMs?: number;
}

/**
 * A ring of recent generator results.
 *
 * `tick(elapsedMs)` advances the cursor and returns the frame now showing, or `null`
 * when the ring is empty. Nothing is scheduled here: the app owns the timer, so a
 * paused tab does not accumulate a backlog (Java's animation ran off the render
 * loop, which had the same property by accident).
 */
export class GeneratorAnimator {
  private readonly frames: AnimFrame[] = [];
  private cursor = 0;
  private elapsed = 0;
  private nextId = 1;
  private readonly history: number;
  private readonly framesPerGrid: number;
  private readonly frameMs: number;

  constructor(options: AnimOptions = {}) {
    this.history = options.history ?? 16;
    this.framesPerGrid = options.framesPerGrid ?? 8;
    this.frameMs = options.frameMs ?? 250;
  }

  /** Record a result. Called from `onUpgrade`/`onStore`. */
  push(tooltip: string): void {
    for (let i = 0; i < this.framesPerGrid; i++) {
      this.frames.push({ id: this.nextId, tooltip, durationMs: this.frameMs });
      this.nextId++;
    }
    while (this.frames.length > this.history * this.framesPerGrid) this.frames.shift();
  }

  /** Advance by `elapsedMs`, returning the frame now showing (or `null`). */
  tick(elapsedMs: number): AnimFrame | null {
    if (this.frames.length === 0) return null;
    this.cursor %= this.frames.length;
    const frame = this.frames[this.cursor] ?? null;
    this.elapsed += elapsedMs;
    while (this.elapsed >= this.frameMs) {
      this.elapsed -= this.frameMs;
      this.cursor = (this.cursor + 1) % this.frames.length;
    }
    return frame;
  }

  /** The frame showing right now, without advancing. */
  current(): AnimFrame | null {
    if (this.frames.length === 0) return null;
    return this.frames[this.cursor % this.frames.length] ?? null;
  }

  get size(): number {
    return this.frames.length;
  }

  clear(): void {
    this.frames.length = 0;
    this.cursor = 0;
    this.elapsed = 0;
  }
}

/** Snapshot a grid's tooltip for the animator. */
export function animFrameFor<TGrid extends GeneratorGrid<TGrid>>(grid: TGrid): string {
  grid.calculate();
  return grid.tooltip();
}
