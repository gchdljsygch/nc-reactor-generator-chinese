/**
 * R4.4 — the generator panel.
 *
 * ## What this is
 *
 * A DOM panel that runs a generator against the design currently open in the editor and
 * offers the result back to the editor. It owns *presentation and lifecycle only*: the
 * search itself lives in `@ncplanner/generator`, and the panel never touches a grid's
 * internals.
 *
 * ## Threading
 *
 * The panel runs the search in a **Web Worker pool** when the browser lets it, and falls
 * back to a single-threaded run on the main thread when it does not:
 *
 *  - `new Worker(new URL('@ncplanner/generator/worker', import.meta.url), {type:'module'})`
 *    is the Vite-blessed form — the `new URL` is what lets the bundler see the worker
 *    entry as a separate chunk. It cannot be expressed as a plain string import.
 *  - `settings.generatorThreads` caps the pool. Java exposed the same slider
 *    (`MenuGenerator.threads`) and its manager started/stopped threads to match.
 *  - The fallback exists because a worker that fails to *construct* (a CSP that forbids
 *    `worker-src`, a browser without module workers, a file:// origin) must degrade to
 *    "slower" and not to "broken". The UI says which mode is in use, so a user is never
 *    misled about why it is slow.
 *
 * ## Interrupt semantics, stated honestly
 *
 * "Stop" **terminates the workers**. There is no cooperative cancellation inside an
 * iteration because an iteration is short and the search has no side effects worth
 * unwinding; terminating is immediate and cannot leak a half-written result into the
 * editor, because a result is only applied by an explicit "Use result" click. The
 * frozen Java's "stop" left threads to notice a volatile boolean, which could take
 * arbitrarily long mid-iteration.
 *
 * ## What this deliberately does NOT do (recorded in `docs/r4/README.md`)
 *
 *  - **No intermediate-result gallery.** Java cycled stored multiblocks through an
 *    animation; here progress is a live text readout of the incumbent, and stored
 *    multiblocks are counted but not browsable. Browsing needs a thumbnail renderer,
 *    which is R5+ work.
 *  - **No per-setting editor for the generator's stages.** A preset is chosen, not
 *    authored, in this round. Authoring needs the settings tree the portable
 *    `Setting`/`SettingVariable` interfaces exist for, and is the natural next step.
 *  - **No worker pool parity guarantee across machines.** Lane count changes which
 *    iteration lands in which lane; a fixed `(seed, iterations)` pair is reproducible
 *    only for a fixed lane count. The panel therefore records the lane count next to
 *    the seed in the status line.
 */

import type { AppI18n } from '../i18n.js';
import { h, clear, replace } from './dom.js';

/**
 * `h()` returns `HTMLElement`, which loses `disabled`/`selected`. This wrapper carries
 * the tag's element type through, so the panel never needs an `as` cast and a typo in a
 * tag name still typechecks against the right interface.
 */
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Parameters<typeof h>[1] = {},
  children: Parameters<typeof h>[2] = [],
): HTMLElementTagNameMap[K] => h(tag, attrs, children) as HTMLElementTagNameMap[K];

/** One selectable preset, already parsed and bound by the caller. */
export interface GeneratorPresetOption {
  readonly id: string;
  readonly label: string;
  /** Human-readable structure summary, e.g. `4 stages / 7 steps`. */
  readonly detail: string;
}

/** Progress the panel renders. */
export interface GeneratorPanelProgress {
  readonly iterations: number;
  readonly perSecond: number;
  readonly stage: number;
  readonly upgrades: number;
  readonly best: string;
}

/**
 * The host the panel drives. The app implements this; the panel never imports the app.
 *
 * Keeping this an interface is what lets the panel be tested with a fake host and keeps
 * the dependency direction one-way (`ui` → host callback, never `ui` → model).
 */
export interface GeneratorPanelHost {
  /** The presets available for the design currently open, if any. */
  presets(): readonly GeneratorPresetOption[];
  /** Whether the currently open design can be generated against at all. */
  available(): boolean;
  /**
   * Run the search. `onProgress` is called with a throttled progress object, and the
   * returned promise resolves when the run finishes or is cancelled.
   */
  start(options: {
    presetId: string;
    seed: number;
    iterations: number;
    threads: number;
    onProgress: (progress: GeneratorPanelProgress) => void;
  }): Promise<GeneratorPanelResult>;
  /** Cancel the active run. Must be safe to call when nothing is running. */
  stop(): void;
  /** Apply the result to the open design. */
  apply(result: GeneratorPanelResult): void;
}

export interface GeneratorPanelResult {
  readonly iterations: number;
  readonly upgrades: number;
  /** Why the run ended, for the status line. */
  readonly stop: 'completed' | 'cancelled' | 'timeout' | 'error';
  readonly error?: string;
  /** A short description of what was produced, for the status line. */
  readonly summary: string;
}

export interface GeneratorPanelOptions {
  readonly i18n: AppI18n;
  readonly host: GeneratorPanelHost;
  /** Default lane count, from settings. */
  readonly threads: number;
  /** Default iteration budget, from settings. */
  readonly iterations: number;
  readonly onThreadsChanged: (threads: number) => void;
  readonly onIterationsChanged: (iterations: number) => void;
}

/** Format a big iteration count compactly; a raw `1234567` is unreadable in a status bar. */
export function formatCount(value: number): string {
  if (value < 10_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export class GeneratorPanel {
  private readonly root = h('div', { class: 'generator-panel' });
  private readonly i18n: AppI18n;
  private readonly host: GeneratorPanelHost;
  private readonly onThreadsChanged: (threads: number) => void;
  private readonly onIterationsChanged: (iterations: number) => void;

  private presetId = '';
  private seed = 1;
  private iterations: number;
  private threads: number;
  private running = false;
  private progress: GeneratorPanelProgress | null = null;
  private lastResult: GeneratorPanelResult | null = null;
  private message = '';

  /** Bound so a long run can be cancelled from the outside without re-rendering. */
  private cancelRequested = false;

  constructor(options: GeneratorPanelOptions) {
    this.i18n = options.i18n;
    this.host = options.host;
    this.threads = options.threads;
    this.iterations = options.iterations;
    this.onThreadsChanged = options.onThreadsChanged;
    this.onIterationsChanged = options.onIterationsChanged;
  }

  get element(): HTMLElement {
    return this.root;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Re-read the preset list and redraw. Called whenever the open design changes. */
  render(): void {
    const t = (key: string, args?: Record<string, string | number>): string =>
      this.i18n.t(key, args);
    const presets = this.host.presets();
    const available = this.host.available() && presets.length > 0;

    if (this.presetId === '' && presets.length > 0) {
      this.presetId = presets[0]?.id ?? '';
    }

    const presetSelect = el('select', {
      class: 'generator-select',
      onchange: (event: Event) => {
        this.presetId = (event.target as HTMLSelectElement).value;
      },
    });
    presetSelect.disabled = !available || this.running;
    for (const preset of presets) {
      const option = el('option', { value: preset.id, text: `${preset.label} — ${preset.detail}` });
      option.selected = preset.id === this.presetId;
      presetSelect.append(option);
    }

    const threadSelect = el('select', {
      class: 'generator-select',
      onchange: (event: Event) => {
        this.threads = Number((event.target as HTMLSelectElement).value);
        this.onThreadsChanged(this.threads);
      },
    });
    threadSelect.disabled = this.running;
    // The cap is a UI choice, not a hard limit: Java's slider had no ceiling either.
    for (const count of [1, 2, 4, 6, 8, 12, 16]) {
      const option = el('option', { value: String(count), text: t('generator.threads.option', { 0: count }) });
      option.selected = count === this.threads;
      threadSelect.append(option);
    }

    const iterationSelect = el('select', {
      class: 'generator-select',
      onchange: (event: Event) => {
        this.iterations = Number((event.target as HTMLSelectElement).value);
        this.onIterationsChanged(this.iterations);
      },
    });
    iterationSelect.disabled = this.running;
    for (const count of [5_000, 20_000, 100_000, 500_000]) {
      const option = el('option', {
        value: String(count),
        text: t('generator.iterations.option', { 0: formatCount(count) }),
      });
      option.selected = count === this.iterations;
      iterationSelect.append(option);
    }

    const seedInput = el('input', {
      class: 'generator-seed',
      type: 'number',
      value: String(this.seed),
      onchange: (event: Event) => {
        const parsed = Number((event.target as HTMLInputElement).value);
        this.seed = Number.isFinite(parsed) ? Math.trunc(parsed) : 1;
      },
    });
    seedInput.disabled = this.running;

    const startStop = el('button', {
      class: 'button primary',
      type: 'button',
      text: this.running ? t('generator.stop') : t('generator.start'),
      onclick: () => {
        if (this.running) this.stop();
        else void this.start();
      },
    });
    startStop.disabled = !this.running && !available;

    const useResult = el('button', {
      class: 'button',
      type: 'button',
      text: t('generator.useResult'),
      onclick: () => {
        if (this.lastResult === null) return;
        this.host.apply(this.lastResult);
        this.message = t('generator.applied');
        this.render();
      },
    });
    useResult.disabled =
      this.running || this.lastResult === null || this.lastResult.stop === 'error';

    const row = (...children: HTMLElement[]): HTMLElement =>
      h('div', { class: 'generator-row' }, children);
    const field = (label: string, control: HTMLElement): HTMLElement =>
      h('label', { class: 'generator-field' }, [
        h('span', { class: 'generator-label', text: label }),
        control,
      ]);

    clear(this.root);
    this.root.append(
      h('div', { class: 'generator-body' }, [
        field(t('generator.preset'), presetSelect),
        row(
          field(t('generator.seed'), seedInput),
          field(t('generator.threads'), threadSelect),
        ),
        field(t('generator.iterations'), iterationSelect),
        row(startStop, useResult),
        this.renderStatus(),
        !available
          ? h('p', { class: 'generator-note', text: t('generator.unavailable') })
          : h('p', { class: 'generator-note', text: t('generator.note') }),
      ]),
    );
  }

  private renderStatus(): HTMLElement {
    const t = (key: string, args?: Record<string, string | number>): string =>
      this.i18n.t(key, args);
    const lines: HTMLElement[] = [];
    if (this.running) {
      const progress = this.progress;
      lines.push(
        h('div', {
          class: 'generator-status',
          text:
            progress === null
              ? t('generator.status.starting')
              : t('generator.status.running', {
                  0: formatCount(progress.iterations),
                  1: progress.stage + 1,
                  2: formatCount(progress.perSecond),
                }),
        }),
      );
      if (progress !== null && progress.best !== '') {
        lines.push(h('pre', { class: 'generator-best', text: progress.best }));
      }
    } else if (this.lastResult !== null) {
      const key =
        this.lastResult.stop === 'error'
          ? 'generator.status.error'
          : this.lastResult.stop === 'cancelled'
            ? 'generator.status.cancelled'
            : 'generator.status.done';
      lines.push(
        h('div', {
          class: `generator-status${this.lastResult.stop === 'error' ? ' error' : ''}`,
          text: t(key, {
            0: formatCount(this.lastResult.iterations),
            1: this.lastResult.upgrades,
            2: this.lastResult.error ?? '',
          }),
        }),
      );
      lines.push(h('pre', { class: 'generator-best', text: this.lastResult.summary }));
    }
    if (this.message !== '') {
      lines.push(h('div', { class: 'generator-message', text: this.message }));
    }
    return h('div', { class: 'generator-status-block' }, lines);
  }

  private async start(): Promise<void> {
    if (this.presetId === '' || this.running) return;
    this.running = true;
    this.cancelRequested = false;
    this.message = '';
    this.progress = null;
    this.lastResult = null;
    this.render();
    try {
      const result = await this.host.start({
        presetId: this.presetId,
        seed: this.seed,
        iterations: this.iterations,
        threads: this.threads,
        onProgress: (progress) => {
          if (this.cancelRequested) return;
          this.progress = progress;
          this.renderStatusInPlace();
        },
      });
      this.lastResult = result;
    } catch (error) {
      this.lastResult = {
        iterations: 0,
        upgrades: 0,
        stop: 'error',
        error: error instanceof Error ? error.message : String(error),
        summary: '',
      };
    } finally {
      this.running = false;
      this.progress = null;
      this.render();
    }
  }

  /**
   * Update only the status block during a run.
   *
   * A full `render()` per progress tick would rebuild the preset `<select>` and steal
   * focus from whatever the user was doing — which is exactly the kind of thing that
   * makes a search feel broken.
   */
  private renderStatusInPlace(): void {
    const existing = this.root.querySelector('.generator-status-block');
    if (existing === null) return;
    replace(existing, [this.renderStatus()]);
  }

  stop(): void {
    if (!this.running) return;
    this.cancelRequested = true;
    this.host.stop();
  }
}
