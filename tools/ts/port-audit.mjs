#!/usr/bin/env node
// R1.0d — file-level port audit for the NC Plannerator rewrite (docs/rewrite-plan-r1-r5.md §4.1).
//
// PURPOSE
//   R0.6 (tools/audit/port-audit.ps1 -> docs/r0/port-audit.md; the PowerShell version was deleted in
//   java-exit-plan §P2 and is only available from git history) classified the port volume with
//   PACKAGE rules: the bucket came from the directory prefix, and only inside `multiblock/` was a
//   light content heuristic applied. That leaves the "must port" line count uncertain by roughly
//   +-30% (rewrite-plan-r1-r5.md §1.3 / risk R-8). This script re-does the classification at FILE
//   level, mechanically and deterministically, so the number can be diffed in CI.
//
// WHAT IT PRODUCES
//   * counts per file: rawLines (R0-compatible) and codeLines (non-blank, non-comment)
//   * exactly one bucket per file: PORT | DROP | REWRITE | VERIFY
//   * exactly one reactor-relevance tag per file
//   * an orthogonal estimate of how much of a mixed file is physics vs UI (method-body signals)
//   * a reconciliation against R0's own per-file table (parsed from docs/r0/port-audit.md)
//   * a schedule scope per file (which rewrite milestone consumes it)
//
// USAGE
//   node tools/ts/port-audit.mjs --summary
//   node tools/ts/port-audit.mjs --json docs/r1/port-audit-file-level.json
//   node tools/ts/port-audit.mjs --report            # every table used by the markdown
//   node tools/ts/port-audit.mjs --summary --no-r0   # skip the R0 reconciliation
//   node tools/ts/port-audit.mjs --baseline docs/r1/port-audit-file-level.json   # CI: replay the snapshot
//
// OPTIONS
//   --src <dir>     source root                (default: src)
//   --r0 <file>     R0 audit markdown          (default: docs/r0/port-audit.md)
//   --json <file>   write the full result as JSON
//   --summary       print the human summary tables (same numbers as the JSON)
//   --report        print the full report (superset of --summary)
//   --no-r0         do not read/parse the R0 audit
//   --baseline <f>  replay a checked-in JSON snapshot instead of scanning `--src`
//
// ---------------------------------------------------------------------------------------------
// COUNTING RULE (documented, deliberately simple)
//   rawLines  = number of lines with length > 0 after splitting on /\r?\n/. This reproduces
//               `Get-Content f | Measure-Object -Line` used by R0.6, so both audits can be
//               compared on the same metric. (Verified: the sum over src/**/*.java is 77825,
//               exactly R0's published total.)
//   codeLines = number of lines that still contain a non-whitespace character AFTER comments are
//               blanked out. `//...` comments (to end of line), `/* ... */` block comments,
//               string literals ("..."), char literals ('...') and text blocks (""" ... """) are
//               replaced by spaces; newlines are preserved, so line numbering and line counts stay
//               intact. Comments inside string literals and vice versa are handled by a small
//               character scanner, so `"// not a comment"` is code and `/* "not a string" */` is a
//               comment. No attempt is made to normalise whitespace or to strip annotations.
//
// CLASSIFICATION RULE (ordered, first match wins; the matching rule name is stored per file)
//   VERIFY   known-broken / frozen-bug semantics (R0 findings 9 and 13) and the crash-recovery
//            policy: these files must NOT be translated line by line, their behaviour has to be
//            re-derived (and R2/R1.4 fixes it deliberately).
//   DROP     UI/rendering/VR/theme/DSSL/discord/old-localisation/GUI, legacy OBJ loaders, image
//            writers, desktop auto-updater, texture manager, editor decals, settings (config2).
//   REWRITE  must exist with a different mechanism: reflection registry (`planner/module`),
//            the hand-written module classes (`planner/ncpf/module/**` with @RegisterWith),
//            and the two duplicated simulators (editor `multiblock/overhaul|underhaul` and
//            generator `multiblock/generator/lite/{overhaulSFR,underhaulSFR}/Lite*|Compiled*`).
//   PORT     everything that stays logic and can be translated semantically 1:1.
//   A file that matches no rule falls through to PORT with reason `default`, and the number of
//   such files is reported, so an unnoticed new package is visible instead of silent.
//
// MIXED-FILE SEAM (estimate, flagged as such everywhere)
//   For every file the script finds Java method bodies (brace matching on the comment/string
//   blanked source) and classifies each body by content signals:
//     phys : neutronFlux|totalHeat|totalOutput|totalEfficiency|calculateStats|propogate|heatMult|
//            moderatorLines|cluster|flux|shutdownFactor
//     ui   : Renderer.|render2d(|render3d(|draw*(|drawText|gl[A-Z]*(|GL_[A-Z]
//   Every code line is then attributed to `phys`, `ui`, `both`, or `other` (innermost method body;
//   lines outside any method are `other`). `seam.phys + seam.ui + seam.both + seam.other` is exactly
//   codeLines. This is a signal-based ESTIMATE of the physics/UI seam, not a real split.
//
// DETERMINISM
//   Files are sorted by their normalised POSIX relative path; JSON keys are emitted in a fixed
//   order; no timestamp, hostname or absolute path is written. Re-running on the same tree prints
//   the same `contentSha256` (sha256 of the canonical JSON payload, hash field itself excluded).
//
// CI GATE (java-exit-plan §P0 / §P2)
//   `EXPECTED_SHA` below pins the frozen Java baseline. `--summary` / `--report` compare the hash of
//   the scanned tree against it and `exit 1` on mismatch, so a silent edit to a `*.java` file fails
//   CI instead of merely printing a new number. `--json` deliberately stays ungated: refreshing the
//   snapshot is `--json <file>`, then bump `EXPECTED_SHA` and the totals in
//   `docs/r0/port-audit.md` / `docs/r1/port-audit-file-level.md`.
//
//   `--baseline <json>` is what CI runs once the Java tree is gone (§P4): it replays the checked-in
//   snapshot — no `--src` needed — and asserts both that the JSON is internally consistent (its own
//   `contentSha256` must equal the hash of its payload) and that it is still the pinned baseline.
//   That is why deleting `src/` can never turn this gate into a silent `files=0` pass (risk R-4).
// ---------------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULE_VERSION = 1;

// Frozen Java baseline (java-exit-plan §P0). See the CI GATE note in the header: the scan must
// reproduce exactly this hash, otherwise the tree drifted away from the audited baseline.
export const EXPECTED_SHA = '7e36b9a5c7c9de15382259418b0941b8ae6cffb47c543946889c9f788beda6a4';

// ---------------------------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { src: 'src', r0: 'docs/r0/port-audit.md', json: null, baseline: null, summary: false, report: false, r0Enabled: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') out.src = argv[++i];
    else if (a === '--r0') out.r0 = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--baseline') out.baseline = argv[++i];
    else if (a === '--summary') out.summary = true;
    else if (a === '--report') out.report = true;
    else if (a === '--no-r0') out.r0Enabled = false;
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 36).join('\n'));
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!out.summary && !out.report && !out.json) out.summary = true;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Source scanning: comment/string blanking, line counting, method bodies
// ---------------------------------------------------------------------------------------------

/**
 * Blank out comments and string/char literal contents, preserving every newline.
 * Returns the transformed source plus the original line list.
 */
export function blankComments(src) {
  const n = src.length;
  const out = new Array(n);
  let i = 0;
  const put = (idx, ch) => { out[idx] = ch === '\n' || ch === '\r' ? ch : ' '; };
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') put(i++, src[i]);
      continue;
    }
    if (c === '/' && c2 === '*') {
      put(i++, c); put(i++, src[i - 1]);
      while (i < n && !(src[i] === '*' && i + 1 < n && src[i + 1] === '/')) put(i++, src[i]);
      if (i < n) { put(i++, '*'); put(i++, '/'); }
      continue;
    }
    if (c === '"' && src.startsWith('"""', i)) {
      put(i++, c); put(i++, c); put(i++, c);
      while (i < n && !src.startsWith('"""', i)) put(i++, src[i]);
      if (i < n) { put(i++, c); put(i++, c); put(i++, c); }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      put(i++, c);
      while (i < n) {
        const d = src[i];
        if (d === '\\') { put(i++, src[i]); if (i < n) put(i++, src[i]); continue; }
        put(i++, d);
        if (d === q) break;
        if (d === '\n') break; // unterminated literal: do not swallow the file
      }
      continue;
    }
    out[i] = c;
    i++;
  }
  return { code: out.join(''), lines: src.split(/\r?\n/) };
}

/** R0-compatible line metric: `Get-Content f | Measure-Object -Line`. */
function rawLineCount(lines) {
  let n = 0;
  for (const l of lines) if (l.replace(/\r$/, '').length > 0) n++;
  return n;
}

function codeLineCount(code) {
  let n = 0;
  for (const l of code.split('\n')) if (l.trim().length > 0) n++;
  return n;
}

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'try', 'do', 'else', 'finally', 'new', 'return']);

/**
 * Find Java method/lambda-block bodies by brace matching on blanked source.
 * Returns [{startLine, endLine, start, end}] (1-based lines, 0-based offsets), innermost last.
 * Control-flow blocks (`if (...) {`) are skipped; this is a heuristic used only for the seam estimate.
 */
export function findMethodBodies(code) {
  const bodies = [];
  const stack = [];
  const lineOf = (idx) => {
    let line = 1;
    for (let i = 0; i < idx; i++) if (code[i] === '\n') line++;
    return line;
  };
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '{') {
      // look backwards for `)...` -> identifier( -> is it a declaration?
      let j = i - 1;
      while (j >= 0 && /\s/.test(code[j])) j--;
      let isMethod = false;
      let name = null;
      if (j >= 0 && code[j] === ')') {
        // match the parenthesis
        let depth = 1;
        let k = j - 1;
        while (k >= 0 && depth > 0) {
          if (code[k] === ')') depth++;
          else if (code[k] === '(') depth--;
          k--;
        }
        // k now points just before '('
        let m = k;
        while (m >= 0 && /\s/.test(code[m])) m--;
        let e = m;
        while (m >= 0 && /[A-Za-z0-9_$]/.test(code[m])) m--;
        name = code.slice(m + 1, e + 1);
        // declaration head = text since last `;`, `{`, `}` or start
        let h = m;
        while (h >= 0 && !';{}'.includes(code[h])) h--;
        const head = code.slice(h + 1, m + 1);
        isMethod = name.length > 0
          && !CONTROL_KEYWORDS.has(name)
          && !head.includes('=')
          && !/^\s*(new|return|throw)\b/.test(head);
      }
      stack.push({ idx: i, isMethod, name });
      continue;
    }
    if (ch === '}') {
      const frame = stack.pop();
      if (frame && frame.isMethod) {
        bodies.push({ start: frame.idx, end: i, startLine: lineOf(frame.idx), endLine: lineOf(i) });
      }
    }
  }
  return bodies;
}

// ---------------------------------------------------------------------------------------------
// Content signals
// ---------------------------------------------------------------------------------------------
// R0.6's original regexes, kept verbatim so finding #8 (9 files / 7,214 lines) is reproducible.
const R0_PHYS = /neutronFlux|totalHeat|totalOutput|totalEfficiency|calculateStats|propogate|heatMult|moderatorLines|cluster/;
const R0_RENDER = /Renderer|render2d|render3d|void draw\(|getTexture|drawText/;
// R1.0d signals (stricter: `getTexture` is a data accessor, not rendering; bare `cluster`/`flux`
// appear in theme/UI colour names, so the physics signal uses qualified physics identifiers only).
const PHYS = /neutronFlux|totalHeat|totalOutput|totalEfficiency|totalPower|calculateStats|propogate|heatMult|moderatorLines|shutdownFactor|sparsityMult|fluxMult/i;
const UI = /[Rr]enderer\s*\.|\brender2d\s*\(|\brender3d\s*\(|\bdraw[A-Z]\w*\s*\(|\bdrawText\b|\bgl[A-Z][A-Za-z0-9]*\s*\(|GL_[A-Z]|new Mesh\b|new Font\b|\brenderOverlay\b/;
// Token counters used to check R0's finding #8 (physics + rendering in one file) mechanically.
const TOKEN_PATTERNS = {
  rendererType: /\bRenderer\b/g,
  rendererCall: /[Rr]enderer\s*\./g,
  drawCall: /\bdraw[A-Z]\w*\s*\(/g,
  glCall: /\bgl[A-Z][A-Za-z0-9]*\s*\(|GL_[A-Z]/g,
  drawText: /\bdrawText\b/g,
  textureAccessor: /getTexture\s*\(/g,
};
const REAL_RENDER = /[Rr]enderer\s*\.|\bdraw[A-Z]\w*\s*\(|\bgl[A-Z][A-Za-z0-9]*\s*\(|GL_[A-Z]|\bdrawText\b|\brender2d\s*\(|\brender3d\s*\(/;

function countTokens(code) {
  const out = {};
  for (const [name, re] of Object.entries(TOKEN_PATTERNS)) out[name] = (code.match(re) ?? []).length;
  return out;
}
const REGISTERED = /@RegisterWith/;
const REFLECTION = /classgraph|io\.github\.classgraph|org\.reflections|Reflections\b|ClassGraph/;

function lineStarts(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  return starts;
}
function lineIndexAt(starts, idx) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
  }
  return lo; // 0-based
}

/** Attribute every code line to phys/ui/both/other via innermost method bodies. */
export function seamEstimate(code) {
  const starts = lineStarts(code);
  const total = starts.length;
  const assignment = new Array(total).fill('other'); // default for lines outside any method
  const bodies = findMethodBodies(code);
  const perLineBest = new Array(total).fill(-1);
  bodies.forEach((b, bi) => {
    const text = code.slice(b.start, b.end + 1);
    const hasPhys = PHYS.test(text);
    const hasUi = UI.test(text);
    const kind = hasPhys && hasUi ? 'both' : hasPhys ? 'phys' : hasUi ? 'ui' : 'other';
    const from = lineIndexAt(starts, b.start);
    const to = lineIndexAt(starts, b.end);
    for (let li = from; li <= to; li++) {
      // innermost = smallest span; bodies are pushed on close, keep the smallest
      if (perLineBest[li] === -1 || (b.end - b.start) < (bodies[perLineBest[li]].end - bodies[perLineBest[li]].start)) {
        perLineBest[li] = bi;
        assignment[li] = kind;
      }
    }
  });
  const seam = { phys: 0, ui: 0, both: 0, other: 0 };
  for (let li = 0; li < total; li++) if (code.split('\n')[li].trim().length > 0) seam[assignment[li]]++;
  return seam;
}

// ---------------------------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------------------------
const P = 'net/ncplanner/plannerator/';

/** VERIFY: frozen-bug / known-broken semantics + recovery policy (R0 findings 9, 13.2, 13.3, 8.6). */
const VERIFY_PATHS = new Map([
  [`${P}ncpf/element/NCPFSettingsElement.java`, 'r0-known-broken:matches() not reflexive (findings §8)'],
  [`${P}planner/file/reader/LegacyNCPF1Reader.java`, 'r0-known-broken:v1 reader NPE on real files (findings §12.2)'],
  [`${P}planner/file/writer/HellrageWriter.java`, 'r0-known-broken:display name used as identifier (findings §8.6)'],
  [`${P}planner/file/recovery/RecoveryHandler.java`, 'recovery-policy:re-derive, no GL crash mode'],
  [`${P}planner/file/recovery/NonRecoveryHandler.java`, 'recovery-policy:re-derive, no GL crash mode'],
  [`${P}planner/file/recovery/RecoveryModeHandler.java`, 'r0-known-broken:name-based matching + imports GUI dialog'],
]);

/** DROP: exact files (not whole trees). */
const DROP_FILES = new Map([
  [`${P}planner/Updater.java`, 'desktop auto-updater, replaced by web deploy'],
  [`${P}planner/VersionManager.java`, 'desktop version/update plumbing'],
  [`${P}planner/ImageIO.java`, 'AWT/BufferedImage image loading'],
  [`${P}planner/FormattedText.java`, 'rich text shaping for the GL renderer'],
  [`${P}planner/FileChooserResultListener.java`, 'native file chooser callback'],
  [`${P}planner/file/writer/PNGWriter.java`, 'java.awt image export (R2.12 re-does this in the browser)'],
  [`${P}planner/file/ImageFormatWriter.java`, 'image export contract, AWT-coupled'],
]);

/** DROP: whole subtrees. */
const DROP_TREES = [
  [`${P}graphics/`, 'old GL renderer / OBJ loaders / images / fonts'],
  [`${P}discord/`, 'discord bot'],
  [`${P}planner/gui/`, 'Swing-era GUI'],
  [`${P}planner/theme/`, 'GL themes (R3.1 replaces with CSS)'],
  [`${P}planner/vr/`, 'VR menus'],
  [`${P}planner/dssl/`, 'DSSL interpreter (R0 D5: not ported)'],
  [`${P}planner/localization/`, 'old word-fragment localisation (R1.2 replaces it)'],
  [`${P}planner/tutorial/`, 'tutorial content/engine'],
  [`${P}config2/`, 'settings.dat model (R2.11 one-shot migration only)'],
  [`${P}multiblock/configuration/`, 'TextureManager: texture loading'],
  [`${P}multiblock/editor/decal/`, 'render overlays'],
  [`${P}planner/editor/overlay/`, 'editor render overlay'],
];

/** REWRITE: whole subtrees / file patterns (mechanism change). */
const REWRITE_TREES = [
  [`${P}planner/module/`, 'reflection-registered feature modules (R1.3d: explicit registry)'],
  [`${P}multiblock/overhaul/`, 'duplicated editor simulator (R1.5: single kernel)'],
  [`${P}multiblock/underhaul/`, 'duplicated editor simulator (R1.5: single kernel)'],
];
const REWRITE_FILE_PATTERNS = [
  [/^net\/ncplanner\/plannerator\/multiblock\/generator\/lite\/(overhaulSFR|underhaulSFR)\/(Lite|Compiled)/, 'duplicated generator simulator (R1.5: single kernel)'],
];
/** REWRITE by content: the hand-written module classes replaced by a declarative schema (R1.3c). */
const REWRITE_MODULE_TREE = `${P}planner/ncpf/module/`;

const DROP_EDITOR_DIR = `${P}planner/editor/overlay/`;

// ---------------------------------------------------------------------------------------------
// Reactor-relevance tags
// ---------------------------------------------------------------------------------------------
const TAG_RULES = [
  ['discord', (p) => p.startsWith(`${P}discord/`)],
  ['i18n', (p) => p.startsWith(`${P}planner/localization/`)],
  ['ui', (p) => p.startsWith(`${P}graphics/`)
    || p.startsWith(`${P}planner/gui/`)
    || p.startsWith(`${P}planner/theme/`)
    || p.startsWith(`${P}planner/vr/`)
    || p.startsWith(`${P}multiblock/configuration/`)
    || p.startsWith(`${P}multiblock/editor/decal/`)
    || p.startsWith(DROP_EDITOR_DIR)
    || p === `${P}planner/ImageIO.java`
    || p === `${P}planner/FormattedText.java`
    || p === `${P}planner/FileChooserResultListener.java`
    || p === `${P}planner/file/writer/PNGWriter.java`
    || p === `${P}planner/file/ImageFormatWriter.java`],
  ['turbine', (p) => /turbine/i.test(p)],
  ['msr', (p) => /fissionmsr|overhaulmsr|\bmsr\b/i.test(p)],
  ['underhaul', (p) => /underhaul/i.test(p)],
  ['distiller', (p) => /distiller/i.test(p)],
  ['fusion', (p) => /fusion/i.test(p)],
  ['sfr', (p) => /fissionsfr|overhaulsfr|\bsfr\b/i.test(p)],
  ['ncpf-format', (p) => p.startsWith(`${P}ncpf/`) || p.startsWith(`${P}planner/ncpf/`) || p.startsWith(`${P}planner/file/`)],
  ['infra', (p) => p.startsWith(`${P}planner/`)
    || p.startsWith(`${P}multiblock/`)
    || p.startsWith(`${P}config2/`)],
  ['other', () => true],
];

// ---------------------------------------------------------------------------------------------
// Schedule scopes (which rewrite milestone consumes the file)
// ---------------------------------------------------------------------------------------------
const R2_LEGACY = [
  /^net\/ncplanner\/plannerator\/planner\/file\/reader\/(Legacy|Overhaul|Underhaul)/,
  /^net\/ncplanner\/plannerator\/planner\/file\/reader\/(Overhaul|Underhaul)NCConfigReader/,
  /^net\/ncplanner\/plannerator\/planner\/file\/reader\/LegacyNeutronSourceHandler/,
  /^net\/ncplanner\/plannerator\/planner\/file\/writer\/(LegacyNCPFWriter|HellrageWriter|BGStringWriter|PNGWriter)/,
  /^net\/ncplanner\/plannerator\/planner\/file\/recovery\//,
  /^net\/ncplanner\/plannerator\/planner\/file\/ForgeConfig\.java$/,
];
const SCOPE_RULES = [
  ['r1-model', (p) => p.startsWith(`${P}ncpf/`) || p.startsWith(`${P}planner/ncpf/`)],
  ['r2-formats-legacy', (p) => R2_LEGACY.some((re) => re.test(p))],
  ['r1-formats-core', (p) => p.startsWith(`${P}planner/file/`)],
  ['r1-kernel-sfr', (p) => /^net\/ncplanner\/plannerator\/multiblock\/(overhaul\/fissionsfr|underhaul)\//.test(p)
    || /^net\/ncplanner\/plannerator\/multiblock\/generator\/lite\/(overhaulSFR|underhaulSFR)\/(Lite|Compiled)/.test(p)
    || /^net\/ncplanner\/plannerator\/multiblock\/(BlockPos|Axis|BoundingBox|BlockGrid|Direction|Range|Vertex|Edge|PartCount)\.java$/.test(p)
    || /^net\/ncplanner\/plannerator\/multiblock\/generator\/lite\/(CompiledPlacementRule|Priority|LiteMultiblock)\.java$/.test(p)],
  ['r1-kernel-misc', (p) => /^net\/ncplanner\/plannerator\/multiblock\/overhaul\//.test(p)],
  ['r3-ui', (p) => DROP_TREES.slice(0, 8).some(([t]) => p.startsWith(t))
    || p.startsWith(`${P}multiblock/configuration/`)
    || p.startsWith(`${P}multiblock/editor/decal/`)
    || p.startsWith(DROP_EDITOR_DIR)
    || p === `${P}planner/ImageIO.java`
    || p === `${P}planner/FormattedText.java`
    || p === `${P}planner/FileChooserResultListener.java`],
  ['r3-editor-logic', (p) => p.startsWith(`${P}planner/editor/`) || p.startsWith(`${P}multiblock/editor/`)],
  ['r4-generator', (p) => p.startsWith(`${P}multiblock/generator/`) || p.startsWith(`${P}multiblock/tinkers/`)],
  ['drop-misc', (p) => p.startsWith(`${P}config2/`)
    || p === `${P}planner/Updater.java`
    || p === `${P}planner/VersionManager.java`
    || p === `${P}planner/file/writer/PNGWriter.java`
    || p === `${P}planner/file/ImageFormatWriter.java`],
  ['r1-infra', () => true],
];

// ---------------------------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------------------------
export function analyseSource(relPath, text) {
  const { code, lines } = blankComments(text);
  const rawLines = rawLineCount(lines);
  const codeLines = codeLineCount(code);

  const flags = [];
  const hasReflection = REFLECTION.test(code);
  const hasRegistered = REGISTERED.test(code);
  const r0Phys = R0_PHYS.test(code);
  const r0Render = R0_RENDER.test(code);
  const hasPhys = PHYS.test(code);
  const hasUi = UI.test(code);
  const realRender = REAL_RENDER.test(code);
  if (hasPhys) flags.push('physics');
  if (hasUi) flags.push('ui');
  if (hasPhys && hasUi) flags.push('mixed');
  if (hasPhys && realRender) flags.push('physics+render');
  if (hasPhys && !hasUi && r0Render) flags.push('r0-false-mixed'); // R0_8 token only (getTexture)
  if (hasReflection) flags.push('reflection');
  if (hasRegistered) flags.push('registered');
  if (r0Phys && r0Render) flags.push('r0-mixed-9'); // reproduces R0's content heuristic exactly

  // ---- bucket (first match wins)
  let bucket = null;
  let reason = null;
  if (VERIFY_PATHS.has(relPath)) {
    bucket = 'VERIFY'; reason = VERIFY_PATHS.get(relPath);
  }
  if (!bucket) {
    for (const [tree, why] of DROP_TREES) {
      if (relPath.startsWith(tree)) { bucket = 'DROP'; reason = `drop-tree:${tree} (${why})`; break; }
    }
  }
  if (!bucket && DROP_FILES.has(relPath)) { bucket = 'DROP'; reason = `drop-file (${DROP_FILES.get(relPath)})`; }
  if (!bucket) {
    for (const [tree, why] of REWRITE_TREES) {
      if (relPath.startsWith(tree)) { bucket = 'REWRITE'; reason = `rewrite-tree:${tree} (${why})`; break; }
    }
  }
  if (!bucket) {
    for (const [re, why] of REWRITE_FILE_PATTERNS) {
      if (re.test(relPath)) { bucket = 'REWRITE'; reason = `rewrite-file (${why})`; break; }
    }
  }
  if (!bucket && relPath.startsWith(REWRITE_MODULE_TREE)) {
    if (hasRegistered) { bucket = 'REWRITE'; reason = 'hand-written module class -> declarative schema (R1.3c)'; }
    else { bucket = 'PORT'; reason = 'module base/infrastructure (kept)'; }
  }
  if (!bucket) { bucket = 'PORT'; reason = 'default:logic-port'; }

  // ---- relevance tag
  let tag = 'other';
  let tagRule = 'fallback';
  for (const [name, test] of TAG_RULES) {
    if (test(relPath)) { tag = name; tagRule = name; break; }
  }

  // ---- schedule scope
  let scope = 'other';
  for (const [name, test] of SCOPE_RULES) {
    if (test(relPath)) { scope = name; break; }
  }

  const seam = seamEstimate(code);
  return {
    path: relPath, bucket, reason, tag, tagRule, scope,
    rawLines, codeLines, flags, seam,
    tokens: countTokens(code),
    signals: { phys: hasPhys, ui: hasUi, realRender, reflection: hasReflection, registered: hasRegistered, r0Phys, r0Render },
  };
}

// ---------------------------------------------------------------------------------------------
// R0 reconciliation
// ---------------------------------------------------------------------------------------------
export function parseR0(markdown) {
  const perFile = new Map();
  const classes = new Map();
  let totalFiles = null;
  let totalLines = null;
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\|\s*`([A-Z][A-Z0-9-]*)`\s*\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*$/.exec(line);
    if (m) {
      const [, cls, count, path] = m;
      perFile.set(path, { cls, lines: Number(count) });
      const c = classes.get(cls) ?? { files: 0, lines: 0 };
      c.files++; c.lines += Number(count);
      classes.set(cls, c);
      continue;
    }
    const t = /^\|\s*Java 文件\s*\|\s*(\d+)\s*\|/.exec(line);
    if (t) totalFiles = Number(t[1]);
    const t2 = /^\|\s*代码行\s*\|\s*(\d+)\s*\|/.exec(line);
    if (t2) totalLines = Number(t2[1]);
  }
  return { perFile, classes, totalFiles, totalLines };
}

const R0_MUST_BUILD = new Set(['PORT-MODEL', 'PORT-FORMAT', 'PORT-UI-LOGIC', 'PORT-PHYSICS', 'SPLIT-PHYSICS-UI']);

// ---------------------------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------------------------
const BUCKET_ORDER = ['PORT', 'DROP', 'REWRITE', 'VERIFY'];
const TAG_ORDER = ['sfr', 'underhaul', 'msr', 'turbine', 'fusion', 'distiller', 'ncpf-format', 'i18n', 'ui', 'infra', 'discord', 'other'];
const SCOPE_ORDER = ['r1-model', 'r1-formats-core', 'r1-kernel-sfr', 'r1-kernel-misc', 'r1-infra', 'r2-formats-legacy', 'r3-ui', 'r3-editor-logic', 'r4-generator', 'drop-misc', 'other'];

function sumBy(files, key) {
  const m = new Map();
  for (const f of files) {
    const k = key(f);
    const e = m.get(k) ?? { files: 0, rawLines: 0, codeLines: 0 };
    e.files++; e.rawLines += f.rawLines; e.codeLines += f.codeLines;
    m.set(k, e);
  }
  return m;
}
function pkgOf(relPath) {
  const prefix = 'net/ncplanner/plannerator/';
  const rest = relPath.startsWith(prefix) ? relPath.slice(prefix.length) : relPath;
  const segs = rest.split('/');
  segs.pop();
  if (segs.length === 0) return '(root)';
  if (segs[0] === 'planner' || segs[0] === 'multiblock') return segs.slice(0, 2).join('/');
  return segs[0];
}
function sortedEntries(map, order) {
  const keys = [...map.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return keys.map((k) => [k, map.get(k)]);
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
export function run({ srcDir, r0File, cwd = process.cwd() }) {
  const root = resolve(cwd, srcDir);
  const files = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.java')) files.push(full);
    }
  };
  walk(root);
  const rows = files
    .map((full) => relative(root, full).split(sep).join('/'))
    .sort()
    .map((rel) => analyseSource(rel, readFileSync(join(root, rel.split('/').join(sep)), 'utf8')));

  const totals = {
    files: rows.length,
    rawLines: rows.reduce((a, f) => a + f.rawLines, 0),
    codeLines: rows.reduce((a, f) => a + f.codeLines, 0),
  };

  const byBucket = sumBy(rows, (f) => f.bucket);
  const byTag = sumBy(rows, (f) => f.tag);
  const byScope = sumBy(rows, (f) => f.scope);
  const byPkg = sumBy(rows, (f) => pkgOf(f.path));
  const matrix = sumBy(rows, (f) => `${f.bucket}\u0000${f.tag}`);

  const mustBuildBuckets = new Set(['PORT', 'REWRITE', 'VERIFY']);
  const mustBuild = rows.filter((f) => mustBuildBuckets.has(f.bucket));
  const mustBuildTotals = {
    files: mustBuild.length,
    rawLines: mustBuild.reduce((a, f) => a + f.rawLines, 0),
    codeLines: mustBuild.reduce((a, f) => a + f.codeLines, 0),
  };
  const r1ScopeNames = new Set(['r1-model', 'r1-formats-core', 'r1-kernel-sfr', 'r1-kernel-misc', 'r1-infra']);
  const r1MustBuild = mustBuild.filter((f) => r1ScopeNames.has(f.scope));
  const r1MustBuildTotals = {
    files: r1MustBuild.length,
    rawLines: r1MustBuild.reduce((a, f) => a + f.rawLines, 0),
    codeLines: r1MustBuild.reduce((a, f) => a + f.codeLines, 0),
  };
  const sumSeam = (list) => list.reduce((a, f) => ({
    phys: a.phys + f.seam.phys, both: a.both + f.seam.both, ui: a.ui + f.seam.ui, other: a.other + f.seam.other,
  }), { phys: 0, both: 0, ui: 0, other: 0 });
  const r1RewriteAttribution = sumSeam(r1MustBuild.filter((f) => f.bucket === 'REWRITE'));
  const kernelScopes = new Set(['r1-kernel-sfr', 'r1-kernel-misc']);
  const simulatorFiles = rows.filter((f) => kernelScopes.has(f.scope) && f.bucket === 'REWRITE');
  const simulatorAttribution = {
    files: simulatorFiles.length,
    codeLines: simulatorFiles.reduce((a, f) => a + f.codeLines, 0),
    ...sumSeam(simulatorFiles),
  };
  const physicsByReactor = TAG_ORDER
    .map((tag) => {
      const list = simulatorFiles.filter((f) => f.tag === tag);
      if (!list.length) return null;
      return {
        tag, files: list.length,
        rawLines: list.reduce((a, f) => a + f.rawLines, 0),
        codeLines: list.reduce((a, f) => a + f.codeLines, 0),
        ...sumSeam(list),
      };
    })
    .filter(Boolean);
  // R1.3c claims "120 hand-written module classes" (reflection-registered). Measure them.
  const registeredRows = rows.filter((f) => f.flags.includes('registered'));
  const registeredByPkg = sumBy(registeredRows, (f) => pkgOf(f.path));
  const registeredClasses = {
    totalFiles: registeredRows.length,
    modelTree: registeredRows.filter((f) => f.path.startsWith(`${P}ncpf/`) || f.path.startsWith(`${P}planner/ncpf/`)).length,
    byPackage: sortedEntries(registeredByPkg, []).map(([pkg, v]) => ({ pkg, ...v })),
  };

  // ---- R0 reconciliation
  let r0 = null;
  if (r0File) {
    const md = readFileSync(resolve(cwd, r0File), 'utf8');
    const parsed = parseR0(md);
    const mismatches = [];
    let r0LinesMatched = 0;
    for (const f of rows) {
      const e = parsed.perFile.get(f.path);
      if (!e) { mismatches.push({ path: f.path, issue: 'missing-in-r0' }); continue; }
      if (e.lines !== f.rawLines) mismatches.push({ path: f.path, issue: 'line-metric-mismatch', r0: e.lines, mine: f.rawLines });
      else r0LinesMatched += e.lines;
      f.r0Class = e.cls;
      f.r0Lines = e.lines;
    }
    for (const p of parsed.perFile.keys()) if (!rows.some((f) => f.path === p)) mismatches.push({ path: p, issue: 'missing-in-src' });

    const byPkgR0 = new Map();
    for (const f of rows) {
      const key = pkgOf(f.path);
      const e = byPkgR0.get(key) ?? { files: 0, r0Lines: 0, myRawLines: 0, r0Must: 0, myMust: 0, byBucket: {}, r0Classes: {} };
      e.files++;
      e.r0Lines += f.r0Lines ?? 0;
      e.myRawLines += f.rawLines;
      if (R0_MUST_BUILD.has(f.r0Class)) e.r0Must += f.r0Lines ?? 0;
      if (mustBuildBuckets.has(f.bucket)) e.myMust += f.rawLines;
      e.byBucket[f.bucket] = (e.byBucket[f.bucket] ?? 0) + f.rawLines;
      e.r0Classes[f.r0Class] = (e.r0Classes[f.r0Class] ?? 0) + (f.r0Lines ?? 0);
      byPkgR0.set(key, e);
    }
    const directory = [...byPkgR0.entries()]
      .map(([pkg, e]) => ({ pkg, ...e, deltaMust: e.myMust - e.r0Must }))
      .sort((a, b) => Math.abs(b.deltaMust) - Math.abs(a.deltaMust) || (a.pkg < b.pkg ? -1 : 1));

    const transitions = new Map();
    for (const f of rows) {
      const k = `${f.r0Class} -> ${f.bucket}`;
      const e = transitions.get(k) ?? { files: 0, rawLines: 0, codeLines: 0 };
      e.files++; e.rawLines += f.r0Lines ?? 0; e.codeLines += f.codeLines;
      transitions.set(k, e);
    }
    const transitionRows = [...transitions.entries()]
      .map(([k, v]) => { const [from, to] = k.split(' -> '); return { from, to, ...v }; })
      .sort((a, b) => b.rawLines - a.rawLines || (a.from < b.from ? -1 : 1));

    r0 = {
      file: r0File,
      files: parsed.totalFiles,
      rawLines: parsed.totalLines,
      parsedFiles: parsed.perFile.size,
      classes: Object.fromEntries([...parsed.classes.entries()].sort()),
      parsedRawLines: [...parsed.perFile.values()].reduce((a, e) => a + e.lines, 0),
      r0MustBuildLines: [...parsed.perFile.values()].filter((e) => R0_MUST_BUILD.has(e.cls)).reduce((a, e) => a + e.lines, 0),
      linesMatched: r0LinesMatched,
      mismatches,
      directory,
      transitions: transitionRows,
    };
  }

  // ---- ambiguous / mixed files
  const mixedMap = (f) => ({
    path: f.path, bucket: f.bucket, scope: f.scope, rawLines: f.rawLines, codeLines: f.codeLines,
    seam: f.seam, tokens: f.tokens, flags: f.flags, realRender: f.signals.realRender, r0Class: f.r0Class ?? null,
  });
  const sortMixed = (a, b) => b.rawLines - a.rawLines || (a.path < b.path ? -1 : 1);
  // R0 finding #8's nine files (R0's own SPLIT-PHYSICS-UI bucket).
  const r0MixedNine = rows
    .filter((f) => (r0 ? f.r0Class === 'SPLIT-PHYSICS-UI' : f.flags.includes('r0-mixed-9')))
    .map(mixedMap).sort(sortMixed);
  // Everything R0's content heuristic would have flagged as physics+render, wherever it lives.
  const r0MixedSignals = rows.filter((f) => f.flags.includes('r0-mixed-9')).map(mixedMap).sort(sortMixed);
  // Physics files that really do contain rendering calls (the true seam list).
  const realMixed = rows.filter((f) => f.flags.includes('physics+render')).map(mixedMap).sort(sortMixed);

  const payload = {
    ruleVersion: RULE_VERSION,
    source: srcDir.split(sep).join('/'),
    lineCounting: {
      rawLines: 'lines with length>0 after split(/\\r?\\n/) — R0.6-compatible (Get-Content | Measure-Object -Line)',
      codeLines: 'lines with non-whitespace content after blanking //, /* */, "..." and \'...\'',
    },
    totals,
    mustBuild: mustBuildTotals,
    r1MustBuild: r1MustBuildTotals,
    r1RewriteAttribution,
    simulatorAttribution,
    physicsByReactor,
    registeredClasses,
    buckets: Object.fromEntries(sortedEntries(byBucket, BUCKET_ORDER)),
    tags: Object.fromEntries(sortedEntries(byTag, TAG_ORDER)),
    scopes: Object.fromEntries(sortedEntries(byScope, SCOPE_ORDER)),
    matrix: sortedEntries(matrix, []).map(([k, v]) => {
      const [bucket, tag] = k.split('\u0000');
      return { bucket, tag, ...v };
    }).sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag)),
    packages: sortedEntries(byPkg, []).map(([pkg, v]) => ({ pkg, ...v })),
    r0MixedNine,
    r0MixedSignals,
    realMixed,
    r0,
    files: rows.map((f) => ({
      path: f.path, bucket: f.bucket, reason: f.reason, tag: f.tag, scope: f.scope,
      rawLines: f.rawLines, codeLines: f.codeLines, flags: f.flags, seam: f.seam, tokens: f.tokens,
      r0Class: f.r0Class ?? null, r0Lines: f.r0Lines ?? null,
    })),
  };
  const canonical = JSON.stringify(payload, null, 1);
  payload.contentSha256 = createHash('sha256').update(canonical).digest('hex');
  return payload;
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------
const fmt = (n) => n.toLocaleString('en-US');
const pad = (s, w, right = false) => (right ? String(s).padStart(w) : String(s).padEnd(w));

export function renderSummary(r) {
  const L = [];
  L.push('# R1.0d file-level port audit — summary');
  L.push(`# ruleVersion=${r.ruleVersion} source=${r.source} contentSha256=${r.contentSha256}`);
  L.push('');
  L.push(`totals: files=${fmt(r.totals.files)} rawLines=${fmt(r.totals.rawLines)} codeLines=${fmt(r.totals.codeLines)}`);
  L.push(`must-build (PORT+REWRITE+VERIFY): files=${fmt(r.mustBuild.files)} rawLines=${fmt(r.mustBuild.rawLines)} codeLines=${fmt(r.mustBuild.codeLines)}`);
  L.push(`R1 scope (r1-model+r1-formats-core+r1-kernel-sfr+r1-kernel-misc+r1-infra): files=${fmt(r.r1MustBuild.files)} rawLines=${fmt(r.r1MustBuild.rawLines)} codeLines=${fmt(r.r1MustBuild.codeLines)}`);
  L.push(`simulator files (kernel scopes, REWRITE): files=${fmt(r.simulatorAttribution.files)} codeLines=${fmt(r.simulatorAttribution.codeLines)} seam phys=${fmt(r.simulatorAttribution.phys)} both=${fmt(r.simulatorAttribution.both)} ui=${fmt(r.simulatorAttribution.ui)} other=${fmt(r.simulatorAttribution.other)}`);
  L.push(`R1 REWRITE files seam: phys=${fmt(r.r1RewriteAttribution.phys)} both=${fmt(r.r1RewriteAttribution.both)} ui=${fmt(r.r1RewriteAttribution.ui)} other=${fmt(r.r1RewriteAttribution.other)}`);
  L.push('');
  L.push('simulator physics workload by reactor type (kernel scopes, REWRITE only)');
  L.push('  reactor        files   codeLines   seam phys   seam ui   seam other');
  for (const p of r.physicsByReactor) {
    L.push(`  ${pad(p.tag, 12)} ${pad(p.files, 6, true)}  ${pad(fmt(p.codeLines), 10, true)}  ${pad(fmt(p.phys + p.both), 10, true)}  ${pad(fmt(p.ui), 8, true)}  ${pad(fmt(p.other), 10, true)}`);
  }
  L.push('');
  L.push('bucket                  files   rawLines  codeLines  share(raw)  share(code)');
  for (const b of BUCKET_ORDER) {
    const e = r.buckets[b] ?? { files: 0, rawLines: 0, codeLines: 0 };
    const pctR = r.totals.rawLines ? (100 * e.rawLines / r.totals.rawLines).toFixed(1) : '0.0';
    const pctC = r.totals.codeLines ? (100 * e.codeLines / r.totals.codeLines).toFixed(1) : '0.0';
    L.push(`${pad(b, 22)}  ${pad(e.files, 5, true)}  ${pad(fmt(e.rawLines), 9, true)}  ${pad(fmt(e.codeLines), 9, true)}   ${pad(pctR + '%', 7, true)}   ${pad(pctC + '%', 7, true)}`);
  }
  L.push('');
  L.push(`reflection-registered classes (@RegisterWith): files=${fmt(r.registeredClasses.totalFiles)} in ncpf/**+planner/ncpf/**=${fmt(r.registeredClasses.modelTree)}`);
  for (const p of r.registeredClasses.byPackage) L.push(`  ${pad(p.pkg, 40)} ${pad(p.files, 4, true)}`);
  L.push('');
  L.push('bucket x relevance (files / codeLines)');
  const tags = TAG_ORDER.filter((t) => r.matrix.some((m) => m.tag === t));
  L.push(`${pad('  bucket', 12)} ${tags.map((t) => pad(t, 13, true)).join('')}`);
  for (const b of BUCKET_ORDER) {
    const cells = tags.map((t) => {
      const m = r.matrix.find((x) => x.bucket === b && x.tag === t);
      return pad(m ? `${m.files} / ${m.codeLines}` : '-', 13, true);
    });
    L.push(`${pad('  ' + b, 12)} ${cells.join('')}`);
  }
  L.push('');
  L.push('schedule scopes (files, codeLines)');
  for (const s of SCOPE_ORDER) {
    const e = r.scopes[s];
    if (!e) continue;
    L.push(`  ${pad(s, 20)} ${pad(e.files, 5, true)}  ${pad(fmt(e.codeLines), 9, true)}`);
  }
  if (r.r0) {
    L.push('');
    L.push('R0.6 reconciliation');
    L.push(`  R0 published totals: files=${fmt(r.r0.files)} rawLines=${fmt(r.r0.rawLines)}`);
    L.push(`  R0 table parsed:     files=${fmt(r.r0.parsedFiles)} rawLines=${fmt(r.r0.parsedRawLines)}`);
    L.push(`  per-file line metric matched: ${fmt(r.r0.linesMatched)} lines, mismatches=${r.r0.mismatches.length}`);
    L.push(`  R0 "needs port" lines (PORT-*+SPLIT): ${fmt(r.r0.r0MustBuildLines)}`);
    L.push(`  R1.0d must-build lines (same metric): ${fmt(r.mustBuild.rawLines)}  delta=${r.mustBuild.rawLines - r.r0.r0MustBuildLines >= 0 ? '+' : ''}${fmt(r.mustBuild.rawLines - r.r0.r0MustBuildLines)}`);
    L.push(`  R1.0d must-build code lines (stricter): ${fmt(r.mustBuild.codeLines)}`);
    L.push('  classification transitions with the largest line count:');
    for (const t of r.r0.transitions.slice(0, 8)) L.push(`    ${pad(t.from, 18)} -> ${pad(t.to, 8)} files=${pad(fmt(t.files), 4, true)} rawLines=${pad(fmt(t.rawLines), 7, true)}`);
  }
  L.push('');
  L.push('R0 finding #8 re-check (physics + rendering in one file)');
  {
    const sum = (a) => a.reduce((x, f) => ({ files: x.files + 1, rawLines: x.rawLines + f.rawLines, codeLines: x.codeLines + f.codeLines }), { files: 0, rawLines: 0, codeLines: 0 });
    const nine = sum(r.r0MixedNine);
    const real = sum(r.r0MixedNine.filter((f) => f.realRender));
    const tok = sum(r.r0MixedNine.filter((f) => !f.realRender));
    L.push(`  R0 SPLIT-PHYSICS-UI files: ${nine.files} files rawLines=${fmt(nine.rawLines)} codeLines=${fmt(nine.codeLines)}`);
    L.push(`  ... with real render calls: ${real.files} files rawLines=${fmt(real.rawLines)} codeLines=${fmt(real.codeLines)}`);
    L.push(`  ... matched only by getTexture(): ${tok.files} files rawLines=${fmt(tok.rawLines)} codeLines=${fmt(tok.codeLines)}`);
    const rm = sum(r.realMixed);
    L.push(`  R1.0d physics+render (all packages): ${rm.files} files rawLines=${fmt(rm.rawLines)} codeLines=${fmt(rm.codeLines)}`);
  }
  L.push('');
  L.push(`contentSha256=${r.contentSha256}`);
  return L.join('\n');
}

export function renderReport(r) {
  const L = [renderSummary(r), ''];
  L.push('## bucket x relevance full matrix');
  L.push('| bucket | relevance | files | rawLines | codeLines |');
  L.push('|---|---|---:|---:|---:|');
  for (const m of r.matrix) L.push(`| ${m.bucket} | ${m.tag} | ${m.files} | ${m.rawLines} | ${m.codeLines} |`);
  L.push('');
  L.push('## package groups (R1.0d)');
  L.push('| package | files | rawLines | codeLines |');
  L.push('|---|---:|---:|---:|');
  for (const p of r.packages) L.push(`| ${p.pkg} | ${p.files} | ${p.rawLines} | ${p.codeLines} |`);
  L.push('');
  L.push('## simulator physics workload by reactor type (kernel scopes, REWRITE only)');
  L.push('| reactor | files | rawLines | codeLines | seam phys | seam both | seam ui | seam other |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const p of r.physicsByReactor) L.push(`| ${p.tag} | ${p.files} | ${p.rawLines} | ${p.codeLines} | ${p.phys} | ${p.both} | ${p.ui} | ${p.other} |`);
  if (r.r0) {
    L.push('');
    L.push('## directory-by-directory vs R0.6 (sorted by |delta|)');
    L.push('| package | files | lines (identical metric) | R0 needs-port | R1.0d must-build | delta | R0 classes (lines) | R1.0d buckets (lines) |');
    L.push('|---|---:|---:|---:|---:|---:|---|---|');
    for (const d of r.r0.directory) {
      const r0c = Object.entries(d.r0Classes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
      const my = BUCKET_ORDER.filter((b) => d.byBucket[b]).map((b) => `${b}:${d.byBucket[b]}`).join(' ');
      L.push(`| ${d.pkg} | ${d.files} | ${d.myRawLines} | ${d.r0Must} | ${d.myMust} | ${d.deltaMust >= 0 ? '+' : ''}${d.deltaMust} | ${r0c} | ${my} |`);
    }
    L.push('');
    L.push('## R0 class -> R1.0d bucket transitions');
    L.push('| R0 class | R1.0d bucket | files | lines | codeLines |');
    L.push('|---|---|---:|---:|---:|');
    for (const t of r.r0.transitions) L.push(`| ${t.from} | ${t.to} | ${t.files} | ${t.rawLines} | ${t.codeLines} |`);
  }
  L.push('');
  L.push('## R0 finding #8 — the nine SPLIT-PHYSICS-UI files, re-checked per file');
  L.push('token columns count real render calls; `getTexture(...)` is a texture accessor, not rendering.');
  L.push('| file | rawLines | codeLines | Renderer type | renderer. | drawX( | glX( | getTexture( | real render? | bucket | scope | seam phys | seam both | seam ui | seam other |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|:--:|---|---:|---:|---:|---:|');
  let raw = 0, code = 0;
  for (const f of r.r0MixedNine) {
    raw += f.rawLines; code += f.codeLines;
    L.push(`| ${f.path} | ${f.rawLines} | ${f.codeLines} | ${f.tokens.rendererType} | ${f.tokens.rendererCall} | ${f.tokens.drawCall} | ${f.tokens.glCall} | ${f.tokens.textureAccessor} | ${f.realRender ? 'yes' : 'NO'} | ${f.bucket} | ${f.scope} | ${f.seam.phys} | ${f.seam.both} | ${f.seam.ui} | ${f.seam.other} |`);
  }
  L.push('');
  const realOnly = r.r0MixedNine.filter((f) => f.realRender);
  const falseOnly = r.r0MixedNine.filter((f) => !f.realRender);
  const sum = (a) => a.reduce((x, f) => ({ files: x.files + 1, rawLines: x.rawLines + f.rawLines, codeLines: x.codeLines + f.codeLines }), { files: 0, rawLines: 0, codeLines: 0 });
  L.push(`nine-file total: ${r.r0MixedNine.length} files, rawLines=${raw}, codeLines=${code}`);
  L.push(`  really physics+render (has draw/renderer calls): ${realOnly.length} files, rawLines=${sum(realOnly).rawLines}, codeLines=${sum(realOnly).codeLines}`);
  L.push(`  R0-only match via getTexture(...):               ${falseOnly.length} files, rawLines=${sum(falseOnly).rawLines}, codeLines=${sum(falseOnly).codeLines}`);
  L.push('');
  L.push('## all files matching R0\'s physics+render content heuristic (any package)');
  L.push('| file | rawLines | codeLines | flags | bucket | scope | real render? |');
  L.push('|---|---:|---:|---|---|---|:--:|');
  for (const f of r.r0MixedSignals) L.push(`| ${f.path} | ${f.rawLines} | ${f.codeLines} | ${f.flags.join(',')} | ${f.bucket} | ${f.scope} | ${f.realRender ? 'yes' : 'NO'} |`);
  L.push('');
  L.push('## files that are physics AND rendering at the same time (R1.0d definition)');
  L.push('| file | rawLines | codeLines | bucket | scope | seam phys | seam both | seam ui | seam other |');
  L.push('|---|---:|---:|---|---|---:|---:|---:|---:|');
  for (const f of r.realMixed) L.push(`| ${f.path} | ${f.rawLines} | ${f.codeLines} | ${f.bucket} | ${f.scope} | ${f.seam.phys} | ${f.seam.both} | ${f.seam.ui} | ${f.seam.other} |`);
  L.push('');
  L.push(`physics+render total: ${sum(r.realMixed).files} files, rawLines=${sum(r.realMixed).rawLines}, codeLines=${sum(r.realMixed).codeLines}`);
  L.push('');
  L.push('## per-file classification (sorted by path)');
  L.push('| path | bucket | relevance | scope | raw | code | R0 class | R0 lines | reason |');
  L.push('|---|---|---|---|---:|---:|---|---:|---|');
  for (const f of r.files) L.push(`| ${f.path} | ${f.bucket} | ${f.tag} | ${f.scope} | ${f.rawLines} | ${f.codeLines} | ${f.r0Class ?? '-'} | ${f.r0Lines ?? '-'} | ${f.reason} |`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Baseline replay (java-exit-plan §P2)
// ---------------------------------------------------------------------------------------------

/**
 * Recompute a payload's canonical hash the same way `run()` does: stringify everything except the
 * `contentSha256` field with the identical indentation, then sha256 it. Because `run()` appends
 * `contentSha256` last, removing it restores the exact hashed string.
 */
export function payloadSha256(payload) {
  const { contentSha256, ...rest } = payload;
  return createHash('sha256').update(JSON.stringify(rest, null, 1)).digest('hex');
}

/** Read a checked-in snapshot and report whether its stored hash matches its own payload. */
export function loadBaseline(file, cwd = process.cwd()) {
  const payload = JSON.parse(readFileSync(resolve(cwd, file), 'utf8'));
  return { payload, recomputed: payloadSha256(payload), stored: payload.contentSha256 ?? null };
}

/**
 * `--baseline <json>`: replay a snapshot without touching `src/`.
 * Fails when the snapshot is internally inconsistent or no longer the pinned baseline.
 */
function replayBaseline(args) {
  let loaded;
  try {
    loaded = loadBaseline(args.baseline);
  } catch (err) {
    console.error(`[port-audit] cannot read baseline ${args.baseline}: ${err.message}`);
    process.exit(1);
  }
  const { payload, recomputed, stored } = loaded;
  const problems = [];
  if (stored !== recomputed) {
    problems.push(`the snapshot's contentSha256 (${stored}) does not match the hash of its own payload (${recomputed})`);
    problems.push('  the JSON was edited by hand — regenerate it with:');
    problems.push('    node tools/ts/port-audit.mjs --json docs/r1/port-audit-file-level.json');
  }
  if (stored !== EXPECTED_SHA) {
    problems.push(`the snapshot is not the pinned baseline: stored ${stored}, EXPECTED_SHA ${EXPECTED_SHA}`);
    problems.push('  if the Java tree really changed, update EXPECTED_SHA in tools/ts/port-audit.mjs deliberately');
  }
  if (problems.length) {
    console.error(`[port-audit] baseline ${args.baseline} rejected:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  if (args.report) console.log(renderReport(payload));
  else console.log(renderSummary(payload));
  console.log(`[port-audit] baseline ${args.baseline} verified (contentSha256=${stored})`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.baseline) {
    replayBaseline(args);
    return;
  }
  const result = run({ srcDir: args.src, r0File: args.r0Enabled ? args.r0 : null });
  if (args.json) {
    const target = resolve(process.cwd(), args.json);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(result, null, 1) + '\n');
    console.log(`wrote ${args.json} (${fmt(result.totals.files)} files, contentSha256=${result.contentSha256})`);
  }
  if (args.report) console.log(renderReport(result));
  else if (args.summary) console.log(renderSummary(result));

  // ---- CI gate: the scanned tree must reproduce the frozen baseline hash.
  if ((args.summary || args.report) && result.contentSha256 !== EXPECTED_SHA) {
    console.error('');
    console.error(`[port-audit] contentSha256 mismatch: expected ${EXPECTED_SHA}`);
    console.error(`[port-audit]                        got      ${result.contentSha256}`);
    for (const m of (result.r0?.mismatches ?? []).slice(0, 20)) {
      console.error(m.issue === 'line-metric-mismatch'
        ? `  line-metric-mismatch: ${m.path} (r0=${m.r0} now=${m.mine})`
        : `  ${m.issue}: ${m.path}`);
    }
    console.error('  If the change is intentional, refresh the snapshot first:');
    console.error('    node tools/ts/port-audit.mjs --json docs/r1/port-audit-file-level.json');
    console.error('  then update EXPECTED_SHA in tools/ts/port-audit.mjs plus the totals/hash in');
    console.error('  docs/r0/port-audit.md and docs/r1/port-audit-file-level.md.');
    process.exit(1);
  }
}

// Only run the CLI when this file is the entry point; importing it must be side-effect free.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
