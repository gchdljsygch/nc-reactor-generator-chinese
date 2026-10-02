/**
 * `@ncplanner/app` — the UI shell (R3).
 *
 * R1 kept this package empty on purpose: M1 is "the kernel runs the four reactor
 * types and the golden datasets pass, with no UI at all". R3 fills it in:
 *
 * | module | what the plan asked for |
 * |---|---|
 * | `settings.ts` | R3.2 — language/theme persisted (JSON, not `config2`) |
 * | `i18n.ts` | R3.2 / R3.8 — runtime language switching, no bare strings |
 * | `model/grid.ts`, `model/editor.ts` | R3.5 — grid editing, symmetry, undo/redo |
 * | `model/document.ts` | R3.3 / R3.4 — project, palette, element configuration |
 * | `model/simulate.ts` | R3.8 — statistics, via the one kernel (iron law 1) |
 * | `model/open.ts` | R3.3 — one open path for drop / picker / tests |
 * | `ui/*` | R3.1 / R3.6 / R3.7 — shell, theme, 2D and WebGL 3D views |
 * | `model/generatorBridge.ts`, `model/generatorHost.ts`, `ui/generator.ts` | R4.4 — the generator panel |
 * | `styles/theme.css` | R3.1 — CSS variables instead of 5,107 lines of Java |
 *
 * Dependency direction (enforced by `tools/ts/lint.mjs`):
 *
 *     app → formats / i18n / kernel → ncpf
 *
 * `kernel` and `ncpf` must never import this package.
 */

export const APP_PACKAGE = '@ncplanner/app';

export * from './settings.js';
export * from './i18n.js';
export * from './model/grid.js';
export * from './model/editor.js';
export * from './model/document.js';
export * from './model/open.js';
export * from './model/simulate.js';
export * from './model/generatorBridge.js';
export * from './model/generatorHost.js';
