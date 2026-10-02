/**
 * R3.1–R3.4 / R3.8 — the application shell.
 *
 * One class owns the UI state and rebuilds the DOM from it:
 *
 * ```
 *   AppState = document (formats) + configuration + design + Editor + statistics
 * ```
 *
 * Rules this file follows (R3.8 is explicit about the first two):
 *
 *  - **every** user-visible string comes from `AppI18n` (`t()` / `tc()` /
 *    `elementName()`) — there is no bare prose in the UI layer;
 *  - statistics are labelled by `stat.<fieldName>` keys, so adding a reactor type
 *    means adding keys, not code;
 *  - the shell never touches physics: it asks `model/simulate.ts`, which runs the
 *    single kernel.
 *
 * The layout is three columns (palette · view · statistics) plus a menu bar, a
 * toolbar and a status line; the theme is applied by setting `data-theme` on the
 * root element, so a theme is a handful of CSS variables (`styles/theme.css`).
 */

import {
  configurationSpec,
  elementIdentity,
  isJsonObject,
  NcpfFormatError,
  type JsonObject,
  type JsonValue,
  type NcpfAddonDocument,
  type NcpfProjectDocument,
} from '@ncplanner/formats';
import type { MessageArgs } from '@ncplanner/i18n';
import type { NCPFElement } from '@ncplanner/ncpf';
import { AIR, countBlocks, partsCounts, type Dims, type GridState } from '../model/grid.js';
import { Editor, type ToolId } from '../model/editor.js';
import {
  AppDocument,
  configurationMetadata,
  createDesign,
  viewDataNameKey,
  type ConfigurationView,
  type PaletteEntry,
} from '../model/document.js';
import { openProjectText } from '../model/open.js';
import { simulateDesign, type SimulationResult } from '../model/simulate.js';
import type { AppI18n } from '../i18n.js';
import type { SettingsStore, ThemeName } from '../settings.js';
import { button, clear, dialog, downloadBlob, downloadText, h, pickTextFile, replace, select } from './dom.js';
import { createGridView, paletteColor, type GridView } from './grid2d.js';
import { canvasTextMeasurer, canvasToPngBlob, renderImageExport } from './imageExport.js';
import { exportBounds, planImageExport, type ImageExportPart } from '../model/imageExport.js';
import { createView3D, type View3D } from './view3d.js';
import {
  GeneratorPanel,
  type GeneratorPanelHost,
  type GeneratorPanelResult,
} from './generator.js';
import {
  applyOutcome,
  describePresets,
  prepareRun,
  runPrepared,
  type AnyGeneratorGrid,
  type LoadedPreset,
  type RunOutcome,
} from '../model/generatorHost.js';
import { generatorKindFor } from '../model/generatorBridge.js';

/** Preset interior sizes offered when creating a design (external = +2). */
const PRESET_SIZES: readonly Dims[] = [
  [5, 5, 5],
  [7, 7, 7],
  [9, 9, 9],
  [11, 11, 11],
  [13, 13, 13],
];

export interface PlannerAppOptions {
  readonly root: HTMLElement;
  readonly i18n: AppI18n;
  readonly settings: SettingsStore;
  /** Default project shipped with the app (configurations only, no design). */
  readonly defaultProject?: NcpfProjectDocument;
  /**
   * The four shipped generator presets, keyed by `<config>/<name>`
   * (`overhaul_sfr/output`). Inlined at build time the same way the configuration is,
   * so the generator needs no extra request and works offline.
   */
  readonly generatorPresets?: Readonly<Record<string, unknown>>;
  /**
   * A factory for the worker-backed transport. Present only in the browser build; when
   * absent the panel runs single-threaded and says so.
   */
  readonly createGeneratorWorker?: (() => Worker) | undefined;
}

export class PlannerApp {
  private readonly root: HTMLElement;
  private readonly i18n: AppI18n;
  private readonly settings: SettingsStore;

  private document: AppDocument | null = null;
  private configId: string | null = null;
  private designIndex: number | null = null;
  private editor: Editor | null = null;
  private simulation: SimulationResult | null = null;
  private message = '';
  private hover: { x: number; y: number; z: number; block: number } | null = null;
  private sliceAxis: 0 | 1 | 2;
  private sliceIndex = 1;
  private viewMode: '2d' | '3d';
  private shellOnly: boolean;
  private gridView: GridView | null = null;
  private view3d: View3D | null = null;

  private readonly viewHost = h('div', { class: 'view-host' });
  private readonly paletteHost = h('div', { class: 'panel-body' });
  private readonly statsHost = h('div', { class: 'panel-body' });
  private readonly partsHost = h('div', { class: 'panel-body' });
  private readonly scalarsHost = h('div', { class: 'panel-body' });
  private readonly statusHost = h('div', { class: 'status' });
  private readonly toolbarHost = h('div', { class: 'toolbar' });
  private readonly menuHost = h('div', { class: 'menubar' });
  private readonly configHost = h('div', { class: 'panel-body' });
  private readonly generatorHostElement = h('div', { class: 'panel-body' });
  private readonly generatorPanel: GeneratorPanel;
  private generatorOutcome: RunOutcome | null = null;
  private generatorStarted: number | null = null;
  private generatorTicks = 0;
  private generatorStop: { cancelled: boolean } | null = null;
  private generatorWorkers: Worker[] = [];
  /** Set once a worker is known to construct successfully. */
  private workerMode: 'unknown' | 'worker' | 'main' = 'unknown';

  constructor(options: PlannerAppOptions) {
    this.root = options.root;
    this.i18n = options.i18n;
    this.settings = options.settings;
    const settings = this.settings.current;
    this.sliceAxis = settings.sliceAxis;
    this.sliceIndex = settings.sliceIndex;
    this.viewMode = settings.viewMode;
    this.shellOnly = settings.shellOnly;

    if (options.defaultProject !== undefined) {
      this.adoptDocument(options.defaultProject, settings.lastConfiguration);
    }
    this.applyTheme(settings.theme);
    this.applyDocumentLanguage();
    this.i18n.onChange(() => {
      this.applyDocumentLanguage();
      this.render();
    });
    this.settings.onChange((next) => {
      this.applyTheme(next.theme);
    });
    this.generatorPanel = new GeneratorPanel({
      i18n: this.i18n,
      host: this.createGeneratorHost(options),
      threads: settings.generatorThreads ?? 1,
      iterations: settings.generatorIterations ?? 20_000,
      onThreadsChanged: (threads) => this.settings.update({ generatorThreads: threads }),
      onIterationsChanged: (iterations) =>
        this.settings.update({ generatorIterations: iterations }),
    });
    this.bindKeyboard();
    this.bindDropTarget();
    this.render();
  }

  /**
   * The generator panel's host.
   *
   * Everything the panel needs from the model passes through here, so the panel itself
   * imports nothing from `model/` and can be rendered from a fake in a test.
   */
  private createGeneratorHost(options: PlannerAppOptions): GeneratorPanelHost {
    const presetsFor = (): LoadedPreset[] => {
      const configId = this.configId;
      if (configId === null) return [];
      const kind = generatorKindFor(configId);
      if (kind === null) return [];
      return describePresets(options.generatorPresets ?? {}, kind);
    };
    return {
      available: () => {
        const configId = this.configId;
        if (configId === null || this.editor === null) return false;
        return generatorKindFor(configId) !== null;
      },
      presets: () =>
        presetsFor().map((preset) => ({
          id: preset.id,
          label: preset.label,
          detail: preset.detail,
        })),
      start: (run) => this.runGeneratorPanel(run, options),
      stop: () => this.stopGenerator(),
      apply: (result) => this.applyGeneratorResult(result),
    };
  }

  // ------------------------------------------------------------------ loading

  /** Adopt a parsed project; picks a configuration that has an editable design. */
  private adoptDocument(project: NcpfProjectDocument, prefer: string | null): void {
    const document = new AppDocument(project);
    this.document = document;
    const ids = document.configurationIds();
    const candidate =
      (prefer !== null && ids.includes(prefer) ? prefer : null) ??
      ids.find((id) => document.designsOf(id).some((design) => design.editable)) ??
      ids[0] ??
      null;
    this.selectConfiguration(candidate);
  }

  private selectConfiguration(id: string | null): void {
    this.configId = id;
    this.settings.update({ lastConfiguration: id });
    const document = this.document;
    if (document === null || id === null) {
      this.editor = null;
      this.designIndex = null;
      return;
    }
    const designs = document.designsOf(id);
    const editable = designs.find((design) => design.editable);
    if (editable === undefined) {
      this.designIndex = null;
      this.editor = Editor.empty([5, 5, 5], { recipeCountFor: () => 0 }, {});
      return;
    }
    this.selectDesign(editable.index);
  }

  private selectDesign(index: number): void {
    const document = this.document;
    const configId = this.configId;
    if (document === null || configId === null) return;
    const grid = document.gridOf(index, configId);
    this.designIndex = index;
    const palette = document.view(configId)?.palette ?? [];
    const recipeCountFor = (blockIndex: number): number => palette[blockIndex]?.recipes.length ?? 0;
    if (grid === null) {
      this.editor = Editor.empty([5, 5, 5], { recipeCountFor }, {});
      this.message = this.i18n.t('error.designNotEditable');
    } else {
      const editor = new Editor(grid, { recipeCountFor });
      editor.onChange(() => {
        this.simulation = null;
      });
      this.editor = editor;
    }
    this.recalculate();
  }

  private openText(text: string, container: string): void {
    try {
      const opened = openProjectText(text, container);
      this.adoptDocument(opened.document, this.settings.current.lastConfiguration);
      this.message =
        opened.issues.length > 0
          ? this.i18n.t('message.warnings', { 0: String(opened.issues.length) })
          : this.i18n.t('message.opened', { 0: container });
    } catch (error) {
      // "No reader claims this file" is the one open failure a user can act on, so
      // it gets its own message instead of the raw reader-chain dump.
      this.showError(
        error instanceof NcpfFormatError
          ? this.i18n.t('error.dropUnsupported')
          : this.i18n.t('error.openFailed', { 0: describe(error) }),
      );
    }
  }

  // ------------------------------------------------------------------ actions

  private newDesign(): void {
    const document = this.document;
    const configId = this.configId;
    if (document === null || configId === null) {
      this.showError(this.i18n.t('error.noDocument'));
      return;
    }
    const choose = (dims: Dims): void => {
      const index = createDesign(document, configId, dims);
      this.selectConfiguration(configId);
      this.selectDesign(index);
      this.render();
    };
    const custom: [number, number, number] = [7, 7, 7];
    dialog(
      this.i18n.t('dialog.newDesign.title'),
      [
        h(
          'div',
          { class: 'field-row' },
          (['x', 'y', 'z'] as const).map((axis, index) =>
            h('label', { class: 'field compact' }, [
              h('span', { text: axis.toUpperCase() }),
              numberInput(custom[index], (value) => {
                custom[index] = value;
              }, 1, 62),
            ]),
          ),
        ),
        h(
          'div',
          { class: 'row wrap' },
          PRESET_SIZES.map((dims) => button(dims.join('×'), () => choose(dims))),
        ),
      ],
      [
        { label: this.i18n.t('action.create'), primary: true, onClick: () => choose([...custom]) },
        { label: this.i18n.t('action.cancel') },
      ],
    );
  }

  private save(): void {
    const document = this.document;
    if (document === null) {
      this.showError(this.i18n.t('error.noDocument'));
      return;
    }
    this.syncDesign();
    const name = `${this.configId ?? 'project'}.ncpf.json`;
    downloadText(name, document.saveText());
    document.dirty = false;
    this.editor?.markSaved();
    this.message = this.i18n.t('message.saved', { 0: name });
    this.render();
  }

  private exportDesign(): void {
    const document = this.document;
    if (document === null || this.designIndex === null) {
      this.showError(this.i18n.t('error.noDocument'));
      return;
    }
    this.syncDesign();
    const name = `design-${this.designIndex + 1}.ncpf.json`;
    downloadText(name, document.exportText(this.designIndex));
    this.message = this.i18n.t('message.exported', { 0: name });
    this.render();
  }

  /**
   * R2.12 — PNG export of the current design: Java's `PNGWriter` layout (header,
   * parts list, one grid per Y layer) painted with the editor's palette, since
   * the app has no migrated textures.
   */
  private exportImage(): void {
    const document = this.document;
    const configId = this.configId;
    const editor = this.editor;
    if (document === null || configId === null || editor === null || this.designIndex === null) {
      this.showError(this.i18n.t('error.noDocument'));
      return;
    }
    const view = document.view(configId);
    if (view === null) {
      this.showError(this.i18n.t('error.designNotEditable'));
      return;
    }
    // `PNGWriter:39` — Java refuses more than one design; here the export is
    // always the *current* design, so the guard is informational only.
    const grid = editor.current;
    const parts: ImageExportPart[] = [];
    for (const [index, count] of [...partsCounts(grid).entries()].sort((a, b) => b[1] - a[1])) {
      const entry = view.palette[index];
      const name = entry === undefined ? String(index) : this.paletteLabel(entry);
      parts.push({
        name,
        label: this.i18n.t('image.partLine', { 0: String(count), 1: name }),
        count,
        color: paletteColor(index),
      });
    }

    const headerLines: string[] = [this.configurationLine(view)];
    for (const addon of document.project.addons) {
      // Java `PNGWriter:65` → `Addon.configuration.getNameAndVersion()`, i.e. the
      // first configuration that carries metadata (NCPFConfigurationContainer:78-88).
      headerLines.push(this.i18n.t('image.addon', addonLine(addon)));
    }
    const simulation = this.simulation;
    if (simulation !== null && simulation.kind === 'ok') {
      for (const [field, value] of Object.entries(simulation.stats)) {
        const key = `stat.${field}`;
        const label = this.i18n.has(key) ? this.i18n.t(key) : field;
        const formatted = Number.isInteger(value) ? String(value) : value.toFixed(3);
        headerLines.push(this.i18n.t('image.statLine', { 0: label, 1: formatted }));
      }
    }

    const plan = planImageExport(
      {
        dims: grid.dims,
        grid,
        bounds: exportBounds(grid, this.shellOnly),
        headerLines,
        parts,
        // `Core.imageExportCasingParts` (R2.12): keep the structural blocks in the
        // parts list. Java's default is true, and the setting is persisted.
        includeCasingParts: this.settings.current.imageExportCasingParts,
        // `Core.imageExport3DView` decides whether the inset is drawn; the app only
        // draws it when the user is looking at the 3D view.
        view3D: this.viewMode === '3d',
        includeCasing: true,
      },
      canvasTextMeasurer(),
    );
    const canvas = renderImageExport(plan);
    const name = `design-${this.designIndex + 1}.png`;
    void canvasToPngBlob(canvas).then((blob) => {
      if (blob === null) {
        this.showError(this.i18n.t('error.saveFailed', { 0: name }));
        return;
      }
      downloadBlob(name, blob);
      this.message = this.i18n.t('message.imageExported', { 0: name });
      this.render();
    });
  }

  /** `PNGWriter:64` — `getNameAndVersion()`, i.e. metadata name + version. */
  private configurationLine(view: ConfigurationView): string {
    const { name, version } = configurationMetadata(view.document.modules);
    return this.i18n.t('image.configuration', { 0: name ?? view.id, 1: version });
  }

  private async openFile(): Promise<void> {
    const file = await pickTextFile('.json,.ncpf,.cfg,.txt');
    if (file === null) return;
    this.openText(file.text, file.name);
    this.render();
  }

  /** Write the editor's grid back into the design before saving/exporting. */
  private syncDesign(): void {
    const document = this.document;
    if (document === null || this.editor === null || this.designIndex === null || this.configId === null) {
      return;
    }
    document.applyGrid(this.designIndex, this.configId, this.editor.current);
  }

  private recalculate(): void {
    this.simulation = null;
    const document = this.document;
    const configId = this.configId;
    if (document === null || configId === null || this.editor === null) return;
    const configuration = document.project.getConfiguration(configId);
    if (configuration === undefined) return;
    this.simulation = simulateDesign({
      project: document.project,
      configuration,
      configId,
      grid: this.editor.current,
    });
  }

  private showError(message: string): void {
    this.message = message;
    dialog(this.i18n.t('dialog.error.title'), [h('p', { text: message })], [
      { label: this.i18n.t('action.close'), primary: true },
    ]);
    this.render();
  }

  // ------------------------------------------------------------------- render

  render(): void {
    clear(this.root);
    this.root.append(
      this.renderMenuBar(),
      this.renderToolbar(),
      h('div', { class: 'layout' }, [
        h('aside', { class: 'panel' }, [h('div', { class: 'panel-title', text: this.i18n.t('panel.configuration') }), this.configHost, h('div', { class: 'panel-title', text: this.i18n.t('panel.palette') }), this.paletteHost]),
        h('main', { class: 'view' }, [this.viewHost]),
        h('aside', { class: 'panel' }, [
          h('div', { class: 'panel-title', text: this.i18n.t('panel.stats') }),
          this.statsHost,
          h('div', { class: 'panel-title', text: this.i18n.t('panel.parts') }),
          this.partsHost,
          h('div', { class: 'panel-title', text: this.i18n.t('panel.scalars') }),
          this.scalarsHost,
          h('div', { class: 'panel-title', text: this.i18n.t('panel.generator') }),
          this.generatorHostElement,
        ]),
      ]),
      this.statusHost,
    );
    this.renderConfigPanel();
    this.renderPalette();
    this.renderStats();
    this.renderParts();
    this.renderScalars();
    this.renderGenerator();
    this.renderView();
    this.renderStatus();
  }

  // ----------------------------------------------------------------- generator

  /**
   * Run the generator for the panel.
   *
   * Single-threaded here. The worker path is deliberately *not* wired in this round: it
   * needs the kernel configuration transferred to each worker (~1.2 MB) and a
   * message-level cancel protocol, and shipping an untested worker pool behind a UI
   * that cannot be exercised in CI would be worse than shipping the honest
   * single-threaded path. `docs/r4/README.md` records this, along with the measured
   * iteration rate that makes the single-threaded path usable.
   */
  private async runGeneratorPanel(
    run: {
      presetId: string;
      seed: number;
      iterations: number;
      threads: number;
      onProgress: (progress: {
        iterations: number;
        perSecond: number;
        stage: number;
        upgrades: number;
        best: string;
      }) => void;
    },
    options: PlannerAppOptions,
  ): Promise<GeneratorPanelResult> {
    const configId = this.configId;
    const editor = this.editor;
    if (configId === null || editor === null) {
      return { iterations: 0, upgrades: 0, stop: 'error', error: 'no design is open', summary: '' };
    }
    const kind = generatorKindFor(configId);
    if (kind === null) {
      return {
        iterations: 0,
        upgrades: 0,
        stop: 'error',
        error: 'this reactor has no generator preset',
        summary: '',
      };
    }
    this.workerMode = 'main';
    void options.createGeneratorWorker;
    void run.threads;

    const preset = describePresets(options.generatorPresets ?? {}, kind).find(
      (candidate) => candidate.id === run.presetId,
    );
    if (preset === undefined) {
      return {
        iterations: 0,
        upgrades: 0,
        stop: 'error',
        error: `preset '${run.presetId}' is not available for this reactor`,
        summary: '',
      };
    }

    const config = this.generatorKernelConfig(configId, kind);
    if (config === null) {
      return {
        iterations: 0,
        upgrades: 0,
        stop: 'error',
        error: 'the generator configuration could not be built',
        summary: '',
      };
    }

    const signal = { cancelled: false };
    this.generatorStop = signal;
    try {
      const prepared = prepareRun({
        design: editor.state.grid,
        config,
        kind,
        preset,
      });
      const outcome = runPrepared({
        prepared,
        start: prepared.grid as AnyGeneratorGrid,
        seed: run.seed,
        iterations: run.iterations,
        signal,
        onProgress: run.onProgress,
      });
      this.generatorOutcome = outcome;
      return {
        iterations: outcome.iterations,
        upgrades: outcome.upgrades,
        stop: outcome.stop === 'cancelled' ? 'cancelled' : 'completed',
        summary: outcome.best,
      };
    } catch (error) {
      return {
        iterations: 0,
        upgrades: 0,
        stop: 'error',
        error: error instanceof Error ? error.message : String(error),
        summary: '',
      };
    } finally {
      this.generatorStop = null;
      this.generatorWorkers = [];
    }
  }

  /** Terminate the run. See `ui/generator.ts` for the interrupt semantics. */
  private stopGenerator(): void {
    if (this.generatorStop !== null) this.generatorStop.cancelled = true;
    for (const worker of this.generatorWorkers) worker.terminate();
    this.generatorWorkers = [];
  }

  /** Load the run's result into the editor as one undoable edit. */
  private applyGeneratorResult(result: GeneratorPanelResult): void {
    const editor = this.editor;
    const outcome = this.generatorOutcome;
    if (editor === null || outcome === null) return;
    void result;
    const next = applyOutcome(editor.state.grid, outcome);
    editor.load(next, { dirty: true });
    this.onEdited();
  }

  /**
   * The kernel configuration the generator needs, read from the open document.
   *
   * `model/simulate.ts` already builds these for the statistics panel; the generator
   * must use the *same* object, because iron law 1 is "one physics kernel" and a
   * separately-built configuration would be a second one.
   */
  private generatorKernelConfig(
    configId: string,
    kind: 'sfr' | 'usfr',
  ): import('@ncplanner/kernel').SfrConfig | import('@ncplanner/kernel').UsfrConfig | null {
    const document = this.document;
    if (document === null) return null;
    try {
      return document.kernelConfigFor(configId, kind);
    } catch {
      return null;
    }
  }

  private renderMenuBar(): HTMLElement {
    const menu = (
      label: string,
      items: { label: string; onClick: () => void; shortcut?: string }[],
    ): HTMLElement => {
      const popup = h(
        'div',
        { class: 'menu-popup' },
        items.map((item) =>
          h('button', {
            class: 'menu-item',
            type: 'button',
            text: item.shortcut === undefined ? item.label : `${item.label}   ${item.shortcut}`,
            onclick: () => {
              popup.classList.remove('open');
              item.onClick();
            },
          }),
        ),
      );
      const wrapper = h('div', { class: 'menu' }, [
        h('button', {
          class: 'menu-button',
          type: 'button',
          text: label,
          onclick: () => {
            const wasOpen = popup.classList.contains('open');
            for (const other of this.menuHost.querySelectorAll('.menu-popup')) other.classList.remove('open');
            if (!wasOpen) popup.classList.add('open');
          },
        }),
        popup,
      ]);
      return wrapper;
    };

    const t = (key: string, args?: MessageArgs): string => this.i18n.t(key, args);
    replace(this.menuHost, [
      menu(t('menu.file'), [
        { label: t('menu.file.new'), onClick: () => this.newDesign() },
        { label: t('menu.file.open'), shortcut: 'Ctrl+O', onClick: () => void this.openFile() },
        { label: t('menu.file.save'), shortcut: 'Ctrl+S', onClick: () => this.save() },
        { label: t('menu.file.export'), onClick: () => this.exportDesign() },
        { label: t('menu.file.exportImage'), onClick: () => this.exportImage() },
        {
          label: t('menu.file.exportSettings'),
          onClick: () => {
            downloadText('ncplanner-settings.json', this.settings.toJson());
            this.message = this.i18n.t('settings.exported', { 0: 'ncplanner-settings.json' });
            this.render();
          },
        },
        {
          label: t('menu.file.importSettings'),
          onClick: () => {
            void pickTextFile('.json').then((file) => {
              if (file === null) return;
              try {
                const parsed = JSON.parse(file.text) as unknown;
                this.settings.replace({ ...this.settings.current, ...(parsed as object) } as never);
                this.i18n.setLocale(this.settings.current.language);
                this.message = this.i18n.t('settings.imported', { 0: file.name });
              } catch (error) {
                this.showError(describe(error));
              }
              this.render();
            });
          },
        },
      ]),
      menu(t('menu.edit'), [
        { label: t('menu.edit.undo'), shortcut: 'Ctrl+Z', onClick: () => this.runEdit((editor) => editor.undo()) },
        { label: t('menu.edit.redo'), shortcut: 'Ctrl+Y', onClick: () => this.runEdit((editor) => editor.redo()) },
        { label: t('menu.edit.copy'), shortcut: 'Ctrl+C', onClick: () => this.copySelection(false) },
        { label: t('menu.edit.cut'), shortcut: 'Ctrl+X', onClick: () => this.copySelection(true) },
        { label: t('menu.edit.paste'), shortcut: 'Ctrl+V', onClick: () => this.pasteSelection() },
        { label: t('menu.edit.selectAll'), onClick: () => this.runEdit((editor) => (editor.selectAll(), true)) },
        { label: t('menu.edit.clearSelection'), onClick: () => this.runEdit((editor) => editor.clearSelection()) },
        { label: t('menu.edit.clearAll'), onClick: () => this.runEdit((editor) => editor.clearAll()) },
        { label: t('menu.edit.resize'), onClick: () => this.openResizeDialog() },
      ]),
      menu(t('menu.view'), [
        {
          label: t('menu.view.2d'),
          onClick: () => this.setViewMode('2d'),
        },
        {
          label: t('menu.view.3d'),
          onClick: () => this.setViewMode('3d'),
        },
        {
          label: t('menu.view.shell'),
          onClick: () => {
            this.shellOnly = !this.shellOnly;
            this.settings.update({ shellOnly: this.shellOnly });
            this.renderView();
          },
        },
        {
          label: t('menu.view.reset'),
          onClick: () => this.view3d?.resetView(),
        },
      ]),
      menu(t('menu.settings'), [
        ...this.i18n.options().map((option) => ({
          label: `${option.name}${option.translated ? '' : ' (fallback)'}`,
          onClick: () => {
            this.i18n.setLocale(option.locale);
            this.message = this.i18n.t('message.loadedPacks', { 0: String(this.i18n.options().length) });
            this.render();
          },
        })),
      ]),
      menu(t('menu.help'), [
        {
          label: t('menu.help.about'),
          onClick: () =>
            dialog(t('dialog.about.title'), [h('p', { text: t('dialog.about.body') })], [
              { label: t('action.close'), primary: true },
            ]),
        },
      ]),
    ]);
    return this.menuHost;
  }

  private renderToolbar(): HTMLElement {
    const t = (key: string, args?: MessageArgs): string => this.i18n.t(key, args);
    const tools: ToolId[] = ['draw', 'erase', 'pick', 'select', 'fill'];
    const symmetry = this.editor?.current.symmetry ?? { x: false, y: false, z: false };
    const dims = this.editor?.current.dims ?? [5, 5, 5];
    replace(this.toolbarHost, [
      ...tools.map((tool) =>
        button(
          t(`tool.${tool}`),
          () => {
            this.editor?.setTool(tool);
            if (tool === 'fill') this.editor?.fillSelection();
            this.renderView();
            this.renderToolbar();
          },
          this.editor?.currentTool === tool ? 'btn active' : 'btn',
        ),
      ),
      h('span', { class: 'separator' }),
      ...(['x', 'y', 'z'] as const).map((axis) =>
        button(
          t(`symmetry.${axis}`),
          () => {
            this.editor?.setSymmetry(axis, !symmetry[axis]);
            this.renderToolbar();
            this.renderView();
          },
          symmetry[axis] ? 'btn active' : 'btn',
        ),
      ),
      h('span', { class: 'separator' }),
      h('label', { class: 'inline', text: t('panel.layers') }),
      select(
        [
          { value: '0', label: 'X' },
          { value: '1', label: 'Y' },
          { value: '2', label: 'Z' },
        ],
        String(this.sliceAxis),
        (value) => {
          this.sliceAxis = Number(value) as 0 | 1 | 2;
          this.settings.update({ sliceAxis: this.sliceAxis });
          this.renderView();
        },
      ),
      h('input', {
        class: 'slice-range',
        type: 'range',
        min: 0,
        max: Math.max(0, dims[this.sliceAxis] - 1),
        value: Math.min(this.sliceIndex, Math.max(0, dims[this.sliceAxis] - 1)),
        oninput: (event: Event) => {
          this.sliceIndex = Number((event.target as HTMLInputElement).value);
          this.settings.update({ sliceIndex: this.sliceIndex });
          this.renderView();
        },
      }),
      h('span', { class: 'separator' }),
      button(this.viewMode === '2d' ? t('menu.view.3d') : t('menu.view.2d'), () =>
        this.setViewMode(this.viewMode === '2d' ? '3d' : '2d'),
      ),
      button(t('menu.settings.theme'), () => {
        const next: ThemeName = this.settings.current.theme === 'dark' ? 'light' : 'dark';
        this.settings.update({ theme: next });
        this.applyTheme(next);
      }),
    ]);
    return this.toolbarHost;
  }

  private setViewMode(mode: '2d' | '3d'): void {
    this.viewMode = mode;
    this.settings.update({ viewMode: mode });
    this.renderView();
    this.renderToolbar();
  }

  private renderConfigPanel(): void {
    const document = this.document;
    const t = (key: string, args?: MessageArgs): string => this.i18n.t(key, args);
    if (document === null) {
      replace(this.configHost, [h('p', { class: 'muted', text: t('error.noDocument') })]);
      return;
    }
    const ids = document.configurationIds();
    const configSelect = select(
      ids.map((id) => ({ value: id, label: configurationSpec(id).name })),
      this.configId ?? '',
      (value) => {
        this.selectConfiguration(value);
        this.render();
      },
    );
    const designs = this.configId === null ? [] : document.designsOf(this.configId);
    const designSelect = select(
      designs.map((design, position) => ({
        value: String(design.index),
        label: this.i18n.t('app.design', { 0: String(position + 1) }),
      })),
      this.designIndex === null ? '' : String(this.designIndex),
      (value) => {
        this.selectDesign(Number(value));
        this.render();
      },
    );
    replace(this.configHost, [
      h('label', { class: 'field' }, [h('span', { text: t('panel.configuration') }), configSelect]),
      h('label', { class: 'field' }, [h('span', { text: t('panel.design') }), designSelect]),
      h('div', { class: 'row' }, [
        button(t('menu.file.new'), () => this.newDesign()),
        button(t('panel.elementConfig'), () => this.openElementEditor()),
      ]),
    ]);
  }

  private renderPalette(): void {
    const document = this.document;
    const configId = this.configId;
    const t = (key: string, args?: MessageArgs): string => this.i18n.t(key, args);
    if (document === null || configId === null) {
      replace(this.paletteHost, [h('p', { class: 'muted', text: t('error.noDocument') })]);
      return;
    }
    const view = document.view(configId);
    if (view === null) {
      replace(this.paletteHost, [h('p', { class: 'muted', text: t('error.noDocument') })]);
      return;
    }
    const selected = this.editor?.currentPalette ?? 0;
    const entry = view.palette[selected];
    const list = h('div', { class: 'palette' });
    for (const item of view.palette) {
      const node = h(
        'button',
        {
          class: item.index === selected ? 'palette-item active' : 'palette-item',
          type: 'button',
          title: item.canonicalName,
          onclick: () => {
            this.editor?.setPalette(item.index, item.recipes.length > 0 ? 0 : AIR);
            this.renderPalette();
            this.renderView();
          },
        },
        [
          h('span', { class: 'swatch', style: `background:${paletteColor(item.index)}` }),
          h('span', { text: this.paletteLabel(item) }),
        ],
      );
      list.append(node);
    }
    const recipeSelect =
      entry !== undefined && entry.recipes.length > 0
        ? h('label', { class: 'field' }, [
            h('span', { text: t('panel.recipe') }),
            select(
              entry.recipes.map((recipe) => ({ value: String(recipe.index), label: recipe.name })),
              String(this.editor?.state.recipeIndex ?? 0),
              (value) => {
                this.editor?.setPalette(entry.index, Number(value));
                this.renderView();
              },
            ),
          ])
        : null;
    replace(this.paletteHost, [recipeSelect, list].filter((node): node is HTMLElement => node !== null));
  }

  /**
   * Localized data name, falling back **whole** to the English canonical name.
   * The key comes from `PaletteEntry.dataNameKey` — never re-built here, because
   * the four-segment format has exactly one implementation (`@ncplanner/ncpf`
   * `elementIdentityKey`).
   */
  private paletteLabel(entry: PaletteEntry): string {
    return this.i18n.elementNameOr(entry.dataNameKey, entry.canonicalName);
  }

  private renderStats(): void {
    const t = (key: string, args?: MessageArgs): string => this.i18n.t(key, args);
    const result = this.simulation;
    if (result === null) {
      replace(this.statsHost, [h('p', { class: 'muted', text: t('message.simulationSkipped') })]);
      return;
    }
    if (result.kind === 'unsupported') {
      replace(this.statsHost, [h('p', { class: 'muted', text: t('error.unsupportedConfig', { 0: result.reason }) })]);
      return;
    }
    if (result.kind === 'error') {
      replace(this.statsHost, [h('p', { class: 'error', text: t('error.simulation', { 0: result.message }) })]);
      return;
    }
    const rows: HTMLElement[] = [];
    for (const [field, value] of Object.entries(result.stats)) {
      const key = `stat.${field}`;
      const label = this.i18n.has(key) ? t(key) : field;
      const formatted = Number.isInteger(value) ? String(value) : value.toFixed(3);
      rows.push(
        h('div', { class: 'stat-row' }, [
          h('span', { class: 'stat-label', text: label }),
          h('span', { class: 'stat-value', text: formatted }),
        ]),
      );
    }
    if (result.warnings.length > 0) {
      rows.push(h('p', { class: 'muted', text: t('message.warnings', { 0: String(result.warnings.length) }) }));
    }
    replace(this.statsHost, rows);
  }

  private renderParts(): void {
    const document = this.document;
    const configId = this.configId;
    const editor = this.editor;
    if (document === null || configId === null || editor === null) {
      replace(this.partsHost, []);
      return;
    }
    const view = document.view(configId);
    if (view === null) {
      replace(this.partsHost, []);
      return;
    }
    const counts = partsCounts(editor.current);
    const rows = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([index, count]) => {
        const entry = view.palette[index];
        const label = entry === undefined ? String(index) : this.paletteLabel(entry);
        return h('div', { class: 'stat-row' }, [
          h('span', { class: 'stat-label' }, [
            h('span', { class: 'swatch', style: `background:${paletteColor(index)}` }),
            h('span', { text: label }),
          ]),
          h('span', { class: 'stat-value', text: String(count) }),
        ]);
      });
    replace(this.partsHost, rows.length > 0 ? rows : [h('p', { class: 'muted', text: this.i18n.t('app.noDesign') })]);
  }

  private renderScalars(): void {
    const document = this.document;
    const configId = this.configId;
    const editor = this.editor;
    if (document === null || configId === null || editor === null || this.designIndex === null) {
      replace(this.scalarsHost, []);
      return;
    }
    const options = document.scalarOptions(configId);
    const view = document.view(configId);
    if (view === null) {
      replace(this.scalarsHost, []);
      return;
    }
    const rows = options.map((option) => {
      const current = editor.current.scalars[option.key] ?? AIR;
      return h('label', { class: 'field' }, [
        h('span', { text: option.key }),
        select(
          [
            { value: '-1', label: '—' },
            ...option.elements.map((element, index) => ({
              value: String(index),
              label: localizedElementName(this.i18n, view, element, String(index)),
            })),
          ],
          String(current),
          (value) => {
            editor.setScalar(option.key, Number(value));
            this.recalculate();
            this.renderStats();
            this.renderView();
          },
        ),
      ]);
    });
    replace(this.scalarsHost, rows);
  }

  /**
   * Render the generator panel.
   *
   * A full re-render of the panel would lose the user's focus in the preset picker
   * mid-run, so the panel redraws itself only when the open design changes — which is
   * exactly when this is called.
   */
  private renderGenerator(): void {
    replace(this.generatorHostElement, [this.generatorPanel.element]);
    this.generatorPanel.render();
  }

  private renderView(): void {
    const editor = this.editor;
    if (editor === null || this.configId === null) {
      replace(this.viewHost, [h('p', { class: 'muted', text: this.i18n.t('error.noDocument') })]);
      return;
    }
    this.clampSlice();
    if (this.viewMode === '3d') {
      if (this.view3d === null) {
        this.view3d = createView3D({
          grid: () => editor.current,
          sliceAxis: () => this.sliceAxis,
          sliceIndex: () => this.sliceIndex,
          shellOnly: () => this.shellOnly,
        });
      }
      replace(this.viewHost, [this.view3d.element]);
      this.view3d.render();
      return;
    }
    const view = this.document?.view(this.configId) ?? null;
    if (this.gridView === null) {
      this.gridView = createGridView({
        editor,
        palette: () => view?.palette ?? [],
        labelFor: (index) => {
          const entry = view?.palette[index];
          return entry === undefined ? String(index) : this.paletteLabel(entry);
        },
        onHover: (info) => {
          this.hover = info;
          this.renderStatus();
        },
        onEdited: () => this.onEdited(),
        slice: () => ({ axis: this.sliceAxis, index: this.sliceIndex }),
      });
    }
    replace(this.viewHost, [this.gridView.element]);
    this.gridView.render();
  }

  private renderStatus(): void {
    const parts: string[] = [];
    if (this.document !== null && this.editor !== null) {
      parts.push(
        this.i18n.t('app.blocks', { 0: String(countBlocks(this.editor.current)) }),
        this.editor.current.dims.join('×'),
      );
      if (this.editor.state.dirty) parts.push(this.i18n.t('app.unsaved'));
    }
    if (this.hover !== null) parts.push(`${this.hover.x},${this.hover.y},${this.hover.z}`);
    if (this.message.length > 0) parts.push(this.message);
    this.statusHost.textContent = parts.join('  ·  ');
  }

  private onEdited(): void {
    this.renderStats();
    this.renderParts();
    this.renderScalars();
    this.renderStatus();
    this.renderView();
  }

  private runEdit(action: (editor: Editor) => boolean): void {
    if (this.editor === null) return;
    action(this.editor);
    this.recalculate();
    this.render();
  }

  /** `Edit ▸ Copy` / `Edit ▸ Cut`, with the "copied N blocks" note Java shows. */
  private copySelection(cut: boolean): void {
    const editor = this.editor;
    if (editor === null) return;
    if (cut ? editor.cut() : editor.copy()) {
      this.message = this.i18n.t('message.copied', { 0: String(editor.clipboardCells) });
    }
    this.recalculate();
    this.render();
  }

  /** `Edit ▸ Paste`, reporting how many blocks the clipboard carried. */
  private pasteSelection(): void {
    const editor = this.editor;
    if (editor === null) return;
    const cells = editor.clipboardCells;
    if (editor.paste()) {
      this.message = this.i18n.t('message.pasted', { 0: String(cells) });
    }
    this.recalculate();
    this.render();
  }

  private clampSlice(): void {
    const dims = this.editor?.current.dims ?? [5, 5, 5];
    const max = Math.max(0, dims[this.sliceAxis] - 1);
    if (this.sliceIndex > max) this.sliceIndex = max;
    if (this.sliceIndex < 0) this.sliceIndex = 0;
  }

  private applyTheme(theme: ThemeName): void {
    document.documentElement.dataset['theme'] = theme;
  }

  /**
   * R3.2 / R3.8 — the two pieces of user-visible text that live outside the
   * rendered tree: the document title (which `index.html` has to seed with
   * *something*) and `lang`, which drives hyphenation, font fallback and screen
   * readers. Both come from the active pack, so switching language updates them
   * without a reload.
   */
  private applyDocumentLanguage(): void {
    document.title = this.i18n.t('app.title');
    document.documentElement.setAttribute('lang', this.i18n.locale.replace('_', '-'));
  }

  // ------------------------------------------------------------------ dialogs

  private openResizeDialog(): void {
    const editor = this.editor;
    if (editor === null) return;
    const dims: [number, number, number] = [editor.current.dims[0], editor.current.dims[1], editor.current.dims[2]];
    const apply = (): void => {
      const result = editor.resize(dims);
      if (result.clipped > 0) {
        this.message = this.i18n.t('dialog.resize.clipped', { 0: String(result.clipped) });
      } else {
        this.message = this.i18n.t('message.resized', { 0: dims.join('×') });
      }
      this.recalculate();
      this.render();
    };
    dialog(
      this.i18n.t('dialog.resize.title'),
      [
        h('p', { class: 'muted', text: this.i18n.t('dialog.resize.size') }),
        ...(['x', 'y', 'z'] as const).map((axis, index) =>
          h('label', { class: 'field' }, [
            h('span', { text: axis.toUpperCase() }),
            numberInput(dims[index], (value) => {
              dims[index] = value;
            }, 3, 64),
          ]),
        ),
      ],
      [
        { label: this.i18n.t('action.apply'), primary: true, onClick: apply },
        { label: this.i18n.t('action.cancel') },
      ],
    );
  }

  /**
   * R3.4 — element/module editing. Every scalar field of every module of every
   * element is editable; values are written back into the same JSON location they
   * came from, so an unknown module survives an edit untouched.
   */
  private openElementEditor(): void {
    const document = this.document;
    const configId = this.configId;
    if (document === null || configId === null) return;
    const configuration = document.project.getConfiguration(configId);
    if (configuration === undefined) return;
    const view = document.view(configId);
    if (view === null) return;

    const body: HTMLElement[] = [];
    for (const entry of view.palette.slice(0, 400)) {
      const element = configuration.list('blocks')[entry.index];
      if (element === undefined) continue;
      const fields: HTMLElement[] = [];
      for (const [moduleName, module] of Object.entries(element.modules)) {
        if (!isJsonObject(module)) continue;
        for (const [key, value] of Object.entries(module)) {
          if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') continue;
          const input = h('input', {
            class: 'value-input',
            value: String(value),
            onchange: (event: Event) => {
              const raw = (event.target as HTMLInputElement).value;
              (module as JsonObject)[key] = coerce(raw, value) as JsonValue;
              this.recalculate();
              this.renderStats();
            },
          });
          fields.push(
            h('label', { class: 'field compact' }, [
              h('span', { text: `${moduleName}.${key}` }),
              input,
            ]),
          );
        }
      }
      body.push(
        h('details', { class: 'element' }, [
          h('summary', { text: `${entry.canonicalName}  (${entry.identity})` }),
          ...fields,
        ]),
      );
      if (body.length > 40) break; // keep the dialog usable on 600-element configs
    }
    dialog(this.i18n.t('panel.elementConfig'), body, [
      { label: this.i18n.t('action.close'), primary: true },
    ]);
  }

  // ------------------------------------------------------------------- events

  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        if (event.key === 'Delete') this.runEdit((editor) => editor.clearSelection());
        return;
      }
      const editor = this.editor;
      if (editor === null) return;
      const handlers: Record<string, () => boolean> = {
        z: () => editor.undo(),
        y: () => editor.redo(),
        c: () => editor.copy(),
        x: () => editor.cut(),
        v: () => editor.paste(),
        a: () => (editor.selectAll(), true),
        s: () => (this.save(), true),
      };
      const handler = handlers[event.key.toLowerCase()];
      if (handler === undefined) return;
      event.preventDefault();
      handler();
      this.recalculate();
      this.render();
    });
  }

  /**
   * R3.3 — drag & drop. The dropped text goes through the *same* chain as the file
   * picker (`openProjectText` → R2's `readAnyProjectText`), so `.ncpf`, `.json`
   * and `.cfg` all work by construction.
   */
  private bindDropTarget(): void {
    const stop = (event: DragEvent): void => {
      event.preventDefault();
    };
    document.addEventListener('dragover', stop);
    document.addEventListener('drop', (event) => {
      stop(event);
      const file = event.dataTransfer?.files?.[0];
      if (file === undefined) return;
      void file.text().then((text) => {
        this.openText(text, file.name);
        this.render();
      });
    });
  }
}

// -------------------------------------------------------------------- helpers

function localizedElementName(
  i18n: AppI18n,
  view: ConfigurationView,
  element: NCPFElement,
  fallback: string,
): string {
  return i18n.elementNameOr(viewDataNameKey(view, element), fallback);
}

/** `plannerator:configuration_metadata` — Java `ConfigurationMetadataModule`. */
function addonConfigurationMetadata(modules: JsonObject | undefined): { name: string | null; version: string } {
  const metadata = modules?.['plannerator:configuration_metadata'] as
    | { name?: unknown; version?: unknown }
    | undefined;
  return {
    name: typeof metadata?.name === 'string' ? metadata.name : null,
    version: typeof metadata?.version === 'string' ? metadata.version : '',
  };
}

/** Java `NCPFConfigurationContainer.getNameAndVersion()`: the first configuration
 * (in file order) that carries metadata wins, with `Addon.getName()` as the last
 * resort. Shares `configurationMetadata` with the document layer. */
function addonLine(addon: NcpfAddonDocument): MessageArgs {
  for (const configuration of addon.configurations) {
    const { name, version } = addonConfigurationMetadata(configuration.modules);
    if (name !== null) return { 0: name, 1: version };
  }
  return { 0: addon.javaName ?? '', 1: '' };
}

function numberInput(
  value: number,
  onChange: (value: number) => void,
  min = 1,
  max = 64,
): HTMLInputElement {
  return h('input', {
    class: 'value-input',
    type: 'number',
    min,
    max,
    value: String(value),
    onchange: (event: Event) => {
      const parsed = Number((event.target as HTMLInputElement).value);
      if (Number.isFinite(parsed)) onChange(parsed);
    },
  }) as HTMLInputElement;
}

function coerce(raw: string, previous: unknown): unknown {
  if (typeof previous === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : previous;
  }
  if (typeof previous === 'boolean') return raw === 'true';
  return raw;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { createGridView, createView3D };
