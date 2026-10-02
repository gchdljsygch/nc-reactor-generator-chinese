/**
 * R3.1 / R3.3 / R3.4 / R3.5 / R3.6 / R3.8 — the app actually boots and renders.
 *
 * The UI has no framework and no headless-browser dependency, so this test
 * supplies a **minimal DOM**: enough of `document`/`Element` for `ui/dom.ts` and
 * the panels. That is deliberately small — the point is not to emulate a browser
 * but to prove the boot order (settings → language packs → configuration → shell)
 * completes and that the rendered shell contains the panels and palette the R3
 * tasks promise, with every visible string coming from an i18n pack.
 *
 * What this cannot prove (and does not claim): canvas painting, WebGL, CSS layout
 * and file download. Those need a real browser; `docs/r3/README.md` records the
 * manual walkthrough for them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppI18n } from '../src/i18n.js';
import { SettingsStore } from '../src/settings.js';
import { AppDocument } from '../src/model/document.js';
import { PlannerApp } from '../src/ui/app.js';
import { readAnyProjectText } from '@ncplanner/formats';
import nuclearcraft from '../../../datasets/configurations/nuclearcraft.ncpf.json';
import enMessages from '../../../lang/en_US.messages.json';
import enApp from '../../../lang/en_US.app.json';
import zhMessages from '../../../lang/zh_CN.messages.json';
import zhApp from '../../../lang/zh_CN.app.json';
import zhElements from '../../../lang/zh_CN.elements.json';
import { loadPack } from '@ncplanner/i18n';

// --------------------------------------------------------------------- mini DOM

class StubClassList {
  private readonly names = new Set<string>();
  add(...values: string[]): void {
    for (const value of values) this.names.add(value);
  }
  remove(...values: string[]): void {
    for (const value of values) this.names.delete(value);
  }
  contains(value: string): boolean {
    return this.names.has(value);
  }
  toString(): string {
    return [...this.names].join(' ');
  }
}

class StubNode {
  readonly childNodes: StubNode[] = [];
  parent: StubNode | null = null;
  textContent = '';
  constructor(readonly tagName: string) {}

  append(...children: (StubNode | string)[]): void {
    for (const child of children) {
      const node = typeof child === 'string' ? new StubText(child) : child;
      node.parent = this;
      this.childNodes.push(node);
    }
  }
  remove(): void {
    if (this.parent === null) return;
    const index = this.parent.childNodes.indexOf(this);
    if (index >= 0) this.parent.childNodes.splice(index, 1);
    this.parent = null;
  }
  get firstChild(): StubNode | null {
    return this.childNodes[0] ?? null;
  }
  removeChild(child: StubNode): void {
    child.remove();
  }

  /** Depth-first text, which is what a user would read off the screen. */
  get text(): string {
    const children = this.childNodes.map((child) => child.text).join('');
    // `h('div', {text})` sets `textContent` directly and appends no children.
    return children.length > 0 ? children : this.textContent;
  }
}

class StubText extends StubNode {
  constructor(text: string) {
    super('#text');
    this.textContent = text;
  }
  override get text(): string {
    return this.textContent;
  }
}
class StubElement extends StubNode {
  readonly attributes = new Map<string, string>();
  readonly classList = new StubClassList();
  readonly style: Record<string, string> = {};
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  className = '';
  id = '';
  width = 0;
  height = 0;
  files: unknown[] | null = null;
  selected = false;
  readonly dataset: Record<string, string> = {};
  value = '';

  constructor(tagName: string) {
    super(tagName);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'id') this.id = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  querySelectorAll(selector: string): StubElement[] {
    const found: StubElement[] = [];
    const walk = (node: StubNode): void => {
      for (const child of node.childNodes) {
        if (child instanceof StubElement) {
          if (matches(child, selector)) found.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector: string): StubElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  getContext(): null {
    // No canvas in Node: every painter checks for null and no-ops (grid2d, view3d).
    return null;
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  click(): void {
    this.dispatch('click');
  }
  override remove(): void {
    this.classList.remove('open');
    super.remove();
  }
}

function matches(element: StubElement, selector: string): boolean {
  const trimmed = selector.trim();
  if (trimmed.startsWith('.')) return element.classList.contains(trimmed.slice(1)) || element.className.split(/\s+/).includes(trimmed.slice(1));
  if (trimmed.startsWith('#')) return element.id === trimmed.slice(1);
  return element.tagName === trimmed;
}

class StubDocument {
  readonly body = new StubElement('body');
  readonly documentElement = new StubElement('html');
  title = '';
  createElement(tag: string): StubElement {
    return new StubElement(tag);
  }
  createTextNode(text: string): StubText {
    return new StubText(text);
  }
  getElementById(id: string): StubElement | null {
    return this.body.querySelector(`#${id}`);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

/** Install the stub as the global DOM for the duration of the test file. */
function installDom(): StubElement {
  const document = new StubDocument();
  const root = document.createElement('div');
  root.setAttribute('id', 'app');
  document.body.append(root);
  const window = {
    addEventListener(): void {},
    removeEventListener(): void {},
    localStorage: undefined,
  };
  const global = globalThis as unknown as Record<string, unknown>;
  global['document'] = document;
  global['window'] = window;
  global['HTMLElement'] = StubElement;
  global['HTMLInputElement'] = StubElement;
  global['HTMLSelectElement'] = StubElement;
  global['HTMLCanvasElement'] = StubElement;
  global['URL'] = { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} };
  global['Blob'] = class {
    constructor(readonly parts: unknown[], readonly options: unknown) {}
  };
  global['requestAnimationFrame'] = (callback: (time: number) => void) => {
    callback(0);
    return 0;
  };
  return root;
}

// ------------------------------------------------------------------------ tests

/** The installed stub document (the last `installDom()` call wins). */
function stubDocument(): StubDocument {
  return (globalThis as unknown as { document: StubDocument }).document;
}

function app(
  root: StubElement,
  language = 'en_US',
  options: { lastConfiguration?: string } = {},
): { app: PlannerApp; i18n: AppI18n; settings: SettingsStore } {
  const settings = new SettingsStore({
    initial: { language, lastConfiguration: options.lastConfiguration ?? 'nuclearcraft:overhaul_sfr' },
  });
  const i18n = new AppI18n({
    packs: [
      loadPack(enMessages),
      loadPack(enApp),
      loadPack(zhMessages),
      loadPack(zhApp),
      loadPack(zhElements),
    ],
    settings,
  });
  const project = readAnyProjectText(JSON.stringify(nuclearcraft), 'nuclearcraft.ncpf.json').document;
  const instance = new PlannerApp({ root: root as unknown as HTMLElement, i18n, settings, defaultProject: project });
  return { app: instance, i18n, settings };
}

beforeEach(() => {
  installDom();
});

describe('r3 app shell', () => {
  it('boots from the shipped configuration and renders the panels', () => {
    const root = installDom();
    const { app: instance } = app(root);
    instance.render();

    const text = root.text;
    // The menu bar is the shell's spine: one button per menu (File…Help).
    for (const label of ['File', 'Edit', 'View', 'Settings', 'Help']) {
      expect(text, `menu "${label}" is rendered`).toContain(label);
    }
    expect(root.querySelectorAll('.menu-button').length).toBeGreaterThanOrEqual(5);
    expect(text).toContain('Blocks');
    expect(text).toContain('Parts list');
    expect(text).toContain('Statistics');
  });

  it('offers the shipped configurations and a palette for the selected one', () => {
    const root = installDom();
    const { app: instance } = app(root);
    instance.render();

    // One of the toolbar/configuration selects carries the shipped configs; the
    // toolbar's slice-axis select is also a `<select>`, so match on content. The
    // labels come from the packs (`config.overhaul.sfr.configuration` &c.).
    const options = root
      .querySelectorAll('select')
      .flatMap((element) => (element as unknown as { childNodes: StubNode[] }).childNodes)
      .map((node) => node.text);
    expect(options.join(' ')).toContain('Overhaul SFR Configuration');
    expect(options.join(' ')).toContain('Underhaul SFR Configuration');
    // The palette is non-empty: the shipped configuration has hundreds of blocks.
    expect(root.querySelectorAll('.palette-item').length).toBeGreaterThan(50);
  });

  it('renders every panel label through the i18n packs (no fallback prose)', () => {
    const root = installDom();
    const { app: instance, i18n } = app(root);
    instance.render();

    // A missing key returns the key itself (iron law 3), so a rendered literal
    // "panel."/"menu." prefix means a key is missing from the packs.
    const text = root.text;
    for (const prefix of ['panel.', 'menu.', 'tool.', 'action.', 'message.', 'error.', 'stat.']) {
      expect(text).not.toContain(prefix);
    }
    // No UI copy resolved through the fallback chain. Element *data names* are a
    // separate bucket: an English canonical name is not a missing translation
    // (R1.2's data-name bundle is keyed by element identity, and `en_US` uses the
    // canonical names from the configuration itself).
    const coverage = i18n.coverage();
    expect(coverage.byKind.message + coverage.byKind.plural).toBe(0);
  });

  it('switches language at runtime without a reload and keeps the choice', () => {
    const root = installDom();
    // The shipped Overhaul SFR configuration: the migrated element pack covers it
    // (`lang/zh_CN.elements.json` is a 26-entry draft, all fission blocks).
    const { app: instance, i18n, settings } = app(root);
    instance.render();
    expect(root.text).toContain('Parts list');

    i18n.setLocale('zh_CN');
    instance.render();
    expect(root.text).toContain('部件清单');
    expect(root.text).not.toContain('Parts list');
    // Element *data names* are localized too: this pins the four-segment key
    // (`<config>/<cfgType>/<type>|<definition>`) all the way from the palette to
    // the pack. A hand-built key (wrong first segment, or no `type|` prefix)
    // silently falls back to the English canonical name, which is what this
    // assertion catches — `燃料单元` is the pack value for
    // `NuclearCraft/Overhaul SFR Configuration/legacy_block|nuclearcraft:solid_fission_cell`.
    expect(root.text).toContain('燃料单元');
    // Persisted: the store holds the choice, so a reload starts in zh_CN.
    expect(settings.current.language).toBe('zh_CN');
    // The two pieces of user-visible text outside the rendered tree follow too.
    expect(stubDocument().title).toBe('NC 规划器');
    expect(stubDocument().documentElement.getAttribute('lang')).toBe('zh-CN');
  });

  it('exposes the module graph the R4 generator will need', () => {
    const root = installDom();
    const { app: instance } = app(root);
    instance.render();
    // The editor is the single mutation path for the grid (R3.5).
    const editor = (instance as unknown as { editor: { current: { dims: number[] } } | null }).editor;
    expect(editor).not.toBeNull();
    expect(editor!.current.dims).toHaveLength(3);
  });
});
