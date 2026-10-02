/**
 * Minimal DOM helpers.
 *
 * No framework on purpose: R3.1 asks for a theme of *CSS variables* and a UI
 * that is smaller than the 35,274 lines it replaces, and a 40-line `h()` beats a
 * dependency for this. Anything that needs to survive a re-render is rebuilt from
 * state — the app's state lives in the models (`model/*`), never in the DOM.
 */

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export interface ElementSpec {
  readonly tag: string;
  readonly attrs?: Attrs;
  readonly children?: (Node | string | null | undefined)[];
}

export function h(tag: string, attrs: Attrs = {}, children: (Node | string | null | undefined)[] = []): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      continue;
    }
    if (key === 'class') {
      element.className = String(value);
      continue;
    }
    if (key === 'text') {
      element.textContent = String(value);
      continue;
    }
    if (key === 'value' && element instanceof HTMLInputElement) {
      element.value = String(value);
      continue;
    }
    if (value === true) {
      element.setAttribute(key, '');
      continue;
    }
    element.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replace(node: Element, children: (Node | string)[]): void {
  clear(node);
  for (const child of children) node.append(child);
}

export function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  return h('button', { class: className, type: 'button', onclick: onClick, text: label }) as HTMLButtonElement;
}

export function select(
  options: readonly { value: string; label: string }[],
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const element = h('select', {
    onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value),
  }) as HTMLSelectElement;
  for (const option of options) {
    const node = h('option', { value: option.value, text: option.label }) as HTMLOptionElement;
    if (option.value === value) node.selected = true;
    element.append(node);
  }
  return element;
}

/** Modal dialog with a title, body and a row of buttons. Returns a close function. */
export function dialog(
  title: string,
  body: Node[],
  actions: { label: string; primary?: boolean; onClick?: () => void }[],
): () => void {
  const overlay = h('div', { class: 'overlay' });
  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  const box = h('div', { class: 'dialog' }, [
    h('div', { class: 'dialog-title', text: title }),
    h('div', { class: 'dialog-body' }, body),
    h(
      'div',
      { class: 'dialog-actions' },
      actions.map((action) =>
        button(action.label, () => {
          action.onClick?.();
          close();
        }, action.primary === true ? 'btn primary' : 'btn'),
      ),
    ),
  ]);
  overlay.append(box);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  return close;
}

/** Download `text` as a file (the browser's "save as", used by every writer). */
export function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  downloadBlob(fileName, blob);
}

/** Download an existing blob/URL (used by the PNG export, R2.12). */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = h('a', { href: url, download: fileName });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking immediately is safe: the click has already queued the download.
    URL.revokeObjectURL(url);
  }
}

/** Open a file picker and resolve with the chosen file's text. */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file === undefined) {
        resolve(null);
        return;
      }
      void file.text().then((text) => resolve({ name: file.name, text }));
    });
    input.click();
  });
}
