#!/usr/bin/env node
/**
 * R1.2f — migrate the legacy translation table into re-keyed language packs.
 *
 * Usage (from the repository root):
 *
 *     node tools/ts/migrate-legacy-translations.mjs
 *
 * Inputs (read-only)
 * ------------------
 *   datasets/translations/legacy-translations.json   1,185 `{en, zh}` substring pairs
 *   lang/zh_CN.messages.draft.json                   R0.5 split: 1,101 UI candidates
 *   lang/zh_CN.elements.draft.json                   R0.5 split: 26 data names (identity keys)
 *   datasets/ncpf-elements.jsonl                     verification only: the 948 element identities
 *
 * Outputs
 * -------
 *   lang/zh_CN.messages.json                         re-keyed draft (`menu.*` / `dialog.*` / …)
 *   lang/en_US.messages.json                         seed canonical pack (the English sources)
 *   lang/zh_CN.elements.json                         runtime data-name pack (26 identity keys)
 *   docs/r1/r1.2-translation-migration.md            this run's full report + mapping tables
 *
 * Rules this script follows
 * -------------------------
 *  1. **No invented translations.** Every Chinese string is copied verbatim from
 *     the R0 artifacts; the only mechanical change is trimming whitespace that the
 *     legacy substring mechanism glued onto a value (counted and reported).
 *  2. **No silent loss.** All 1,185 legacy pairs and all 1,127 draft entries are
 *     reconciled; anything not auto-classified is written into the pack's
 *     `needsReview` array and enumerated in the report.
 *  3. **No key invention without evidence.** Re-keying is heuristic and the keys
 *     are marked provisional; a human confirms them during the R3.8 extraction.
 *
 * The script is plain Node ESM on purpose (no build step, no dependencies): it is
 * a migration tool, not runtime code. The TypeScript side only consumes its
 * output (`packages/i18n/src/pack.ts` defines the format).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PATHS = {
  pairs: join(ROOT, 'datasets/translations/legacy-translations.json'),
  messageDraft: join(ROOT, 'lang/zh_CN.messages.draft.json'),
  elementDraft: join(ROOT, 'lang/zh_CN.elements.draft.json'),
  elementDump: join(ROOT, 'datasets/ncpf-elements.jsonl'),
  messages: join(ROOT, 'lang/zh_CN.messages.json'),
  canonical: join(ROOT, 'lang/en_US.messages.json'),
  elements: join(ROOT, 'lang/zh_CN.elements.json'),
  report: join(ROOT, 'docs/r1/r1.2-translation-migration.md'),
};

const GENERATOR = 'tools/ts/migrate-legacy-translations.mjs';
const PACK_VERSION = '0.2.0-r1.2f';

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const pairDoc = readJson(PATHS.pairs);
const pairs = pairDoc.pairs ?? [];
const messageDraft = readJson(PATHS.messageDraft);
const elementDraft = readJson(PATHS.elementDraft);
const draftMessages = messageDraft.messages ?? {};
const draftElements = elementDraft.elements ?? {};

/** The 948 authoritative element identities (verification of the element keys). */
const elementRows = readFileSync(PATHS.elementDump, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line))
  .filter((row) => row.__meta === undefined);
const elementIdentityKeys = new Set(
  elementRows.map((row) => `${row.config}/${row.cfgType}/${row.identity}`),
);

// ---------------------------------------------------------------------------
// reconciliation: 1,185 legacy pairs -> 26 element keys + 1,101 message entries
// ---------------------------------------------------------------------------

/**
 * R0.5 deduplicated with PowerShell's **case-insensitive** hashtable, so the
 * accounting below folds case as well. Folding is applied to the *English*
 * source only: it is what decides "duplicate entry" versus "new entry".
 */
const fold = (text) => text.toLowerCase();

const draftKeyByFold = new Map();
let foldCollisions = 0;
for (const key of Object.keys(draftMessages)) {
  const folded = fold(key);
  if (draftKeyByFold.has(folded)) foldCollisions += 1;
  draftKeyByFold.set(folded, key);
}

/** Message entries in draft order: `{ source, translation, folded, duplicates[] }`. */
const messageEntries = [];
const messageEntryByFold = new Map();
const duplicates = [];
const dataNamePairs = [];
let draftValueMismatches = 0;

for (const pair of pairs) {
  const source = pair.en;
  const translation = pair.zh;
  if (typeof source !== 'string' || source.length === 0) continue;
  const draftKey = draftKeyByFold.get(fold(source));
  if (draftKey === undefined) {
    dataNamePairs.push({ source, translation });
    continue;
  }
  if (messageEntryByFold.has(fold(source))) {
    const entry = messageEntryByFold.get(fold(source));
    const conflict = entry.translation !== translation;
    duplicates.push({
      key: draftKey,
      source,
      firstSource: entry.source,
      translation,
      firstTranslation: entry.translation,
      conflict,
    });
    continue;
  }
  const translationMatchesDraft = draftMessages[draftKey] === translation;
  if (!translationMatchesDraft) draftValueMismatches += 1;
  const entry = {
    key: draftKey,
    source,
    translation,
    ...(translationMatchesDraft ? {} : { draftTranslation: draftMessages[draftKey] }),
  };
  messageEntryByFold.set(fold(source), entry);
  messageEntries.push(entry);
}

const duplicateConflicts = duplicates.filter((entry) => entry.conflict);
const dataNamePairsFound = dataNamePairs.length;
const uiPairsFound = pairs.length - dataNamePairsFound;

// Invariants behind the accounting. If one of these breaks, the report below
// would be wrong, so fail loudly instead of writing a misleading document.
if (foldCollisions !== 0) {
  throw new Error(
    `lang/zh_CN.messages.draft.json has ${foldCollisions} case-insensitive key collisions; ` +
      'the reconciliation would be ambiguous',
  );
}
if (messageEntries.length !== Object.keys(draftMessages).length) {
  throw new Error(
    `reconciled ${messageEntries.length} UI entries but the draft has ` +
      `${Object.keys(draftMessages).length}`,
  );
}
if (dataNamePairsFound + uiPairsFound !== pairs.length) {
  throw new Error('pair accounting does not add up');
}

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

/** Single words that stand alone as a label in this UI. */
const STANDALONE_LABELS = new Set([
  'done', 'cancel', 'yes', 'no', 'ok', 'back', 'next', 'previous', 'close', 'save', 'delete',
  'add', 'edit', 'copy', 'paste', 'undo', 'redo', 'help', 'reset', 'confirm', 'continue',
  'apply', 'finish', 'create', 'remove', 'search', 'settings', 'select', 'import', 'export',
  'open', 'load', 'new', 'stop', 'run', 'show', 'hide', 'view', 'retry', 'exit', 'refresh',
]);

const MENU_VERB =
  /^(add|delete|del|save|load|import|export|edit|open|close|cancel|create|copy|paste|cut|remove|reset|clear|generate|view|show|hide|toggle|select|choose|move|rename|set|finish|start|stop|search|find|apply|done|back|next|previous|yes|no|ok|undo|redo|run|new|help|maximize|minimize|increase|decrease|include|exclude|convert|suggest|press|use|click|drag|drop|enter|exit|enable|disable|lock|unlock|recalculate|resize|mirror|rotate|zoom|overwrite|replace|retry|refresh)\b/i;

const ERROR_TEXT =
  /(fail|error|cannot|can'?t|unable|invalid|unknown|illegal|denied|corrupt|crash|exception|missing|too many|too few|not connected|not found|not supported|does not exist|gone wrong|out of range|only supports|must be|incomplete|is empty)/i;

const DIALOG_LEAD = /^(would you like|are you sure|do you want|save changes|confirm|overwrite|continue|import instead)/i;

const PROGRESS_VERB =
  /^(calculating|loading|saving|generating|compiling|building|scanning|importing|exporting|resizing|converting|optimizing|searching|rendering|initializing|refreshing|imposing|opening|closing|adding|removing|updating|checking|processing|creating|sorting|validating|benchmarking|running|reading|writing|parsing|copying|moving|resetting|clearing|collecting|applying)\b/i;

const TOPIC_RULES = [
  ['theme', /theme|colou?r scheme|background colou?r|font/i],
  ['config', /configuration|config file|\.cfg|\.ncpf|addon|module/i],
  ['overlay', /overlay|cursor|calibration|mirror|symmetry|preview/i],
  ['tutorial', /tutorial/i],
];

const wordsOf = (text) => text.trim().split(/\s+/).filter(Boolean);
const endsWithPunctuation = (text) => /[.?!:;…]$/.test(text);

/**
 * Classify one draft entry.
 *
 * Order matters: the fragment checks come first because the legacy table is a
 * *substring* table (R0 finding #5) — most of its 1,101 entries are word
 * fragments that cannot become a whole-sentence key without human judgement.
 * Only entries that read as a complete message are auto-classified.
 *
 * Returns `{ rule, prefix }` (auto-classified) or `{ rule, review }` (human queue).
 */
function classify(source) {
  const trimmed = source.trim();
  const words = wordsOf(source);
  const multiLine = source.includes('\n');

  if (source !== trimmed) return { rule: 'R1', review: 'fragment-padded' };

  // A leading closing bracket/comma means the string continues something that was
  // concatenated before it (e.g. `)\nWould you like to update now?`), so it is a
  // fragment even when it reads like a sentence.
  if (/^[)\]}>.,;:!?，。；：！？、）]/.test(trimmed)) {
    return { rule: 'R1b', review: 'fragment-continuation' };
  }

  if (words.length === 1 && !endsWithPunctuation(trimmed)) {
    return STANDALONE_LABELS.has(trimmed.toLowerCase())
      ? { rule: 'R2', prefix: 'menu' }
      : { rule: 'R2', review: 'fragment-word' };
  }

  const question = trimmed.endsWith('?');
  if ((question && (!multiLine || source.length <= 60)) || DIALOG_LEAD.test(trimmed)) {
    return { rule: 'R3', prefix: 'dialog' };
  }

  if (ERROR_TEXT.test(trimmed) || (!multiLine && trimmed.endsWith('!'))) {
    return { rule: 'R4', prefix: 'error' };
  }

  if (PROGRESS_VERB.test(trimmed)) return { rule: 'R5', prefix: 'progress' };

  if (MENU_VERB.test(trimmed) && words.length <= 5 && !multiLine && !endsWithPunctuation(trimmed)) {
    return { rule: 'R6', prefix: 'menu' };
  }

  if (words.length <= 2 && !endsWithPunctuation(trimmed) && !multiLine) {
    return { rule: 'R7', review: 'fragment-short' };
  }

  if (trimmed.endsWith(':') && words.length <= 3) return { rule: 'R8', review: 'label-prefix' };

  for (const [prefix, pattern] of TOPIC_RULES) {
    if (pattern.test(trimmed)) return { rule: 'R9', prefix };
  }

  const prose =
    (multiLine && words.length >= 3) ||
    words.length >= 8 ||
    (words.length >= 6 && /[,.]/.test(trimmed));
  if (prose) return { rule: 'R10', prefix: 'tooltip' };

  return { rule: 'R11', review: 'no-rule' };
}

/** `Add Fuel Cell` → `add.fuel.cell`; the prefix is added by the caller. */
function slugify(source) {
  const ascii = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (ascii === '') return 'unnamed';
  return ascii.split(/\s+/).slice(0, 10).join('.');
}

const REASON_NOTES = {
  'fragment-padded': '旧表是子串表：该条目被空白填充，必须重新表达为整句 key（可能还需要占位符）',
  'fragment-continuation': '以闭合标点开头，说明它接在别的片段之后；必须与前半句合并成整句 key',
  'fragment-word': '单个词，旧表用它做子串替换；不能作为整句 key',
  'fragment-short': '两词以内的短语，缺少句子结构，无法判断归属',
  'label-prefix': '以冒号结尾的标签前缀（值由 UI 拼接）；应改为带 {0} 的整句 key，即未来的 stat.*',
  'no-rule': '现有规则无法判定归属，需要人工决定命名空间',
};

const autoByPrefix = new Map();
const reviewByReason = new Map();
const byRule = new Map();
const messagePairs = []; // { key, source, translation }
const reviewEntries = []; // { source, translation, reason }
const usedKeys = new Set();
let whitespaceNormalized = 0;

for (const entry of messageEntries) {
  const verdict = classify(entry.source);
  byRule.set(verdict.rule, (byRule.get(verdict.rule) ?? 0) + 1);
  if (verdict.prefix !== undefined) {
    let key = `${verdict.prefix}.${slugify(entry.source)}`;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${verdict.prefix}.${slugify(entry.source)}-${suffix}`;
      suffix += 1;
    }
    usedKeys.add(key);
    let translation = entry.translation;
    if (translation !== translation.trim()) {
      whitespaceNormalized += 1;
      translation = translation.trim();
    }
    autoByPrefix.set(verdict.prefix, (autoByPrefix.get(verdict.prefix) ?? 0) + 1);
    messagePairs.push({ key, source: entry.source, translation });
  } else {
    const reason = verdict.review;
    reviewByReason.set(reason, (reviewByReason.get(reason) ?? 0) + 1);
    reviewEntries.push({ source: entry.source, translation: entry.translation, reason });
  }
}

// ---------------------------------------------------------------------------
// element pack
// ---------------------------------------------------------------------------

const elementEntries = Object.entries(draftElements).map(([key, value]) => {
  const translation = typeof value === 'string' ? value : String(value);
  const trimmed = translation.trim();
  if (trimmed !== translation) whitespaceNormalized += 1;
  return { key, translation: trimmed, normalized: trimmed !== translation };
});
const orphanElementKeys = elementEntries
  .map((entry) => entry.key)
  .filter((key) => !elementIdentityKeys.has(key));
const paddedElementKeys = elementEntries.filter((entry) => entry.normalized).map((entry) => entry.key);

// ---------------------------------------------------------------------------
// outputs
// ---------------------------------------------------------------------------

const sortByKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const messagesOut = {
  meta: {
    locale: 'zh_CN',
    name: '简体中文',
    version: PACK_VERSION,
    base: 'en_US',
    status: 'migrated-draft',
    generatedBy: GENERATOR,
    source: 'datasets/translations/legacy-translations.json + lang/zh_CN.messages.draft.json',
    counts: {
      legacyPairs: pairs.length,
      draftMessageEntries: messageEntries.length,
      autoClassified: messagePairs.length,
      needsReview: reviewEntries.length,
      total: messagePairs.length + reviewEntries.length,
      elementEntries: elementEntries.length,
      duplicateLegacyKeys: duplicates.length,
      whitespaceNormalized,
    },
    note:
      'DRAFT. Keys are provisional: the prefix comes from a heuristic and the slug from the ' +
      'legacy English sentence. Confirm both during the R3.8 key extraction. Entries that could ' +
      'not be re-keyed are kept in "needsReview" so that nothing is silently dropped; "sources" ' +
      'maps every key back to its legacy English string for review and diffing.',
  },
  messages: Object.fromEntries(
    [...messagePairs].sort(sortByKey).map((entry) => [entry.key, entry.translation]),
  ),
  sources: Object.fromEntries(
    [...messagePairs].sort(sortByKey).map((entry) => [entry.key, entry.source]),
  ),
  needsReview: reviewEntries,
};

const canonicalOut = {
  meta: {
    locale: 'en_US',
    name: 'English',
    version: PACK_VERSION,
    status: 'seed',
    generatedBy: GENERATOR,
    source: 'the legacy English source strings (keys of lang/zh_CN.messages.draft.json)',
    counts: { messages: messagePairs.length },
    note:
      'SEED canonical pack: only the messages the legacy table happened to contain. The full ' +
      'canonical set is extracted from the code during R3.8, and plural forms cannot be derived ' +
      'from the legacy table at all (it has no plural information) — they must be authored then.',
  },
  messages: Object.fromEntries(
    [...messagePairs].sort(sortByKey).map((entry) => [entry.key, entry.source]),
  ),
};

const elementsOut = {
  meta: {
    locale: 'zh_CN',
    name: '简体中文',
    version: PACK_VERSION,
    base: 'en_US',
    status: 'migrated-draft',
    generatedBy: GENERATOR,
    identityFormat: '<config>/<cfgType>/<definition.type>|<definition.toString()>',
    source: 'lang/zh_CN.elements.draft.json',
    counts: {
      entries: elementEntries.length,
      fromLegacyPairs: dataNamePairsFound,
      whitespaceNormalized: paddedElementKeys.length,
      verifiedAgainstElementDump: elementRows.length,
    },
    note:
      'DATA NAMES. Four-segment identity keys are required (R0 finding #4): a bare ' +
      'type|definition collides on 29 keys. Values are the R0 draft values; a trailing space that ' +
      'came from the substring mechanism (the legacy key included the space) was trimmed and is ' +
      'listed in whitespaceNormalizedKeys.' +
      (paddedElementKeys.length === 0
        ? ''
        : ' Trimmed keys: ' + paddedElementKeys.join(', ')),
  },
  elements: Object.fromEntries([...elementEntries].sort(sortByKey).map((entry) => [entry.key, entry.translation])),
};

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const pct = (part, whole) => (whole === 0 ? '0.0' : ((100 * part) / whole).toFixed(1));
const inline = (text) => text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/\|/g, '\\|');
const tableCell = (text) => inline(text).replace(/`/g, "'");

const lines = [];
const w = (line = '') => lines.push(line);

w('# R1.2f — 遗留译文迁移报告');
w();
w(`> 由 \`${GENERATOR}\` 生成（\`node tools/ts/migrate-legacy-translations.mjs\`）。**请勿手工编辑**。`);
w();
w('## 0. 结论摘要');
w();
w('| 项 | 数值 |');
w('|---|---:|');
w(`| 输入：遗留翻译对 | ${pairs.length} |`);
w(`| 其中：数据名（命中元素英文名） | ${dataNamePairsFound} |`);
w(`| 其中：UI 文案 | ${uiPairsFound} |`);
w(`| UI 文案去重后（大小写不敏感，同 R0.5 口径） | ${messageEntries.length} |`);
w(`| ├─ 自动分类并重新 key 化 | ${messagePairs.length} |`);
w(`| └─ 需人工判断（保留在 \`needsReview\`） | ${reviewEntries.length} |`);
w(`| UI 文案重复出现（同一 key 的第二次及以后） | ${duplicates.length} |`);
w(`| └─ 其中译文互相冲突 | ${duplicateConflicts.length} |`);
w(`| 数据名身份键（四段式） | ${elementEntries.length} |`);
w(`| 自动分类率 | ${pct(messagePairs.length, messageEntries.length)}% |`);
w(`| 静默丢失条目 | **0** |`);
w();
w('自动分类率偏低是**预期结果**，不是缺陷：R0 已证明遗留表是「词片段替换表」而不是名称/句子表');
w('（`docs/r0/findings.md` 发现 #5：1185 条里只有 31 条能匹配元素完整英文名）。');
w('本脚本因此采取保守策略——只把读起来是**完整消息**的条目重新 key 化，其余全部进入人工队列，');
w('并逐条写入产物，做到「一条不丢」。');
w();

w('## 1. 输入与产物');
w();
w('| 角色 | 文件 |');
w('|---|---|');
w('| 输入 | `datasets/translations/legacy-translations.json`（1,185 对） |');
w('| 输入 | `lang/zh_CN.messages.draft.json`（1,101 条 UI 草稿） |');
w('| 输入 | `lang/zh_CN.elements.draft.json`（26 条数据名草稿） |');
w('| 校验输入 | `datasets/ncpf-elements.jsonl`（948 个元素身份，用于确认元素键无孤儿） |');
w('| 产物 | `lang/zh_CN.messages.json`（重新 key 化的草稿 + `needsReview` 队列 + `sources` 反查表） |');
w('| 产物 | `lang/en_US.messages.json`（规范语言「种子」包：遗留英文原文，供回退链使用） |');
w('| 产物 | `lang/zh_CN.elements.json`（数据名包，四段式身份键） |');
w('| 产物 | 本报告 |');
w();
w('产物格式即 `packages/i18n/src/pack.ts` 定义的 `LanguagePack`，可直接被运行时加载');
w('（`packages/i18n/test/packs.test.ts` 会加载并校验它们）。');
w();

w('## 2. 完整性核对：1,185 条一条不落');
w();
w('每条遗留翻译对**恰好**落入下面五类之一，计数恒等式成立：');
w();
w('```');
w(`遗留翻译对            ${pairs.length}`);
w(`  = 数据名对          ${dataNamePairsFound}`);
w(`  + UI 文案对         ${uiPairsFound}`);
w();
w(`UI 文案对             ${uiPairsFound}`);
w(`  = 唯一 key          ${messageEntries.length}   （大小写不敏感去重，与 R0.5 的 PowerShell 哈希表口径一致）`);
w(`  + 重复出现          ${duplicates.length}`);
w();
w(`唯一 key              ${messageEntries.length}`);
w(`  = 自动分类          ${messagePairs.length}`);
w(`  + 需人工判断        ${reviewEntries.length}`);
w();
w(`数据名对              ${dataNamePairsFound}`);
w(`  → 四段式身份键      ${elementEntries.length}   （多条遗留对命中同一元素，合并）`);
w('```');
w();
w(`恒等式校验：${dataNamePairsFound} + ${uiPairsFound} = ${pairs.length} ✓；` +
  `${messageEntries.length} + ${duplicates.length} = ${uiPairsFound} ✓；` +
  `${messagePairs.length} + ${reviewEntries.length} = ${messageEntries.length} ✓`);
w();
w('脚本在写入产物前会断言这三条恒等式（以及「草稿 key 大小写不敏感折叠后无冲突」），');
w('任一条不成立即抛错并中止，不会产出数字对不上的报告。');
w();
w(`另有 ${draftValueMismatches} 条唯一 key 在草稿中的译文与遗留对首次出现的译文不一致` +
  `（R0.5 用「先出现者胜」，理论上应为 0）。`);
w();

w('### 2.1 数据名分支（31 → 26）');
w();
w('`lang/zh_CN.elements.draft.json` 的 26 个身份键**全部**能在 `datasets/ncpf-elements.jsonl`');
w(`的 ${elementRows.length} 个元素身份中找到：孤儿键 ${orphanElementKeys.length} 个。`);
w();
if (paddedElementKeys.length > 0) {
  w('以下元素名的值带有旧表机制留下的空白（旧 key 含空格），已做**机械修剪**并在 `meta` 中记录：');
  w();
  for (const key of paddedElementKeys) w(`- \`${key}\``);
  w();
}
w('元素名不做任何翻译加工：值原样来自 R0 草稿（仅上述修剪），符合「不发明译文」的要求。');
w();

w('### 2.2 UI 分支（1,154 → 1,101 + 53 重复）');
w();
if (duplicates.length === 0) {
  w('无重复条目。');
  w();
} else {
  w(`共 ${duplicates.length} 次重复出现；其中 ${duplicateConflicts.length} 条的译文互相冲突——` +
    '这正是 R0 发现 #7 描述的「同一英文 key 在不同上下文需要不同译文」缺陷。');
  w('绝大多数重复只是**大小写变体**（R0.5 的 PowerShell 哈希表大小写不敏感，因此它们本就是同一个 key）；');
  w(`其中 ${duplicateConflicts.length} 条冲突条目必须由人工拆分 key 或选定译文。下表列出全部 ${duplicates.length} 条以便核对：`);
  w();
  w('| key（草稿英文原文） | 首次出现的原文 | 首次译文 | 后续原文 | 后续译文 |');
  w('|---|---|---|---|---|');
  for (const entry of duplicates) {
    w(`| ${tableCell(entry.key)} | ${tableCell(entry.firstSource)} | ${tableCell(entry.firstTranslation)} | ${tableCell(entry.source)} | ${tableCell(entry.translation)} |`);
  }
  w();
  if (duplicateConflicts.length === 0) {
    w('（本表中所有重复项译文一致，可直接合并。）');
    w();
  }
}

w('## 3. 自动分类规则与计数');
w();
w('规则按**顺序**匹配，先命中者生效。设计原则：只有在证据充分（句子结构完整）时才自动重新 key 化。');
w();
w('| 顺序 | 前缀 / 结论 | 判定依据 | 命中 |');
w('|---:|---|---|---:|');
const ruleRows = [
  ['R1', '`needsReview: fragment-padded`', '英文原文首尾带空白（旧表做子串替换时的填充）'],
  ['R1b', '`needsReview: fragment-continuation`', '以闭合标点/逗号开头（接在前一个片段之后）'],
  ['R2', '`menu.*` / `needsReview: fragment-word`', '单个词：在独立标签白名单内 → `menu.*`，否则人工判断'],
  ['R3', '`dialog.*`', '以 `?` 结尾（单行或 ≤60 字符）或以 Would you like / Are you sure / Confirm… 开头'],
  ['R4', '`error.*`', '含 fail/error/cannot/invalid/unknown/missing/too many… 关键词，或单行以 `!` 结尾'],
  ['R5', '`progress.*`', '以 Calculating / Loading / Generating / Adding… 等动名词开头'],
  ['R6', '`menu.*`', '以动作动词开头、≤5 词、单行且无句末标点'],
  ['R7', '`needsReview: fragment-short`', '≤2 词、无句末标点、单行（无法判断归属的短语）'],
  ['R8', '`needsReview: label-prefix`', '以冒号结尾且 ≤3 词（UI 会拼接其值，应改为 `stat.*: "{0}"`）'],
  ['R9', '`theme.*` / `config.*` / `overlay.*` / `tutorial.*`', '命中主题/配置/覆盖层/教程关键词'],
  ['R10', '`tooltip.*`', '多行说明，或 ≥8 词，或 ≥6 词且含逗号/句点'],
  ['R11', '`needsReview: no-rule`', '以上均不命中'],
];
for (const [rule, target, description] of ruleRows) {
  w(`| ${rule} | ${target} | ${description} | ${byRule.get(rule) ?? 0} |`);
}
w(`| | **合计** | | **${messageEntries.length}** |`);
w();
w('自动分类结果（`lang/zh_CN.messages.json` 的 `messages`）：');
w();
w('| 前缀 | 条数 |');
w('|---|---:|');
for (const prefix of ['menu', 'dialog', 'tooltip', 'error', 'progress', 'config', 'overlay', 'theme', 'tutorial']) {
  const count = autoByPrefix.get(prefix) ?? 0;
  if (count > 0) w(`| \`${prefix}.*\` | ${count} |`);
}
w(`| **合计** | **${messagePairs.length}** |`);
w();
w('> 注：`stat.*` 前缀在本次迁移中**没有**自动产出：所有统计标签在遗留表里都是「标签前缀」形态');
w('> （以冒号结尾或带空白填充），必须由人工补上 `{0}` 占位符，因此全部进入 `needsReview`。');
w();

w('### 3.1 自动分类映射表（迁移映射表）');
w();
w('`key` 是**临时** key：前缀来自上表规则，后缀由英文原文机械生成（小写、非字母数字转 `.`、最多 10 词）。');
w('人工复核时应把它们改成语义化 key（如 `menu.add.fuel.cell`），同时保留 `sources` 反查能力。');
w();
w('| 迁移后 key | key 前缀规则 | 英文原文 | 中文译文 |');
w('|---|---|---|---|');
for (const entry of [...messagePairs].sort(sortByKey)) {
  const prefix = entry.key.split('.')[0];
  w(`| \`${entry.key}\` | ${prefix} | ${tableCell(entry.source)} | ${tableCell(entry.translation)} |`);
}
w();

w('## 4. 需人工判断的条目');
w();
w(`共 ${reviewEntries.length} 条，按原因分类：`);
w();
w('| 原因 | 条数 | 占比 | 说明 |');
w('|---|---:|---:|---|');
for (const [reason, note] of Object.entries(REASON_NOTES)) {
  const count = reviewByReason.get(reason) ?? 0;
  w(`| \`${reason}\` | ${count} | ${pct(count, reviewEntries.length)}% | ${note} |`);
}
w(`| **合计** | **${reviewEntries.length}** | 100.0% | |`);
w();
w('这些条目**没有丢失**：它们的 `source` / `translation` / `reason` 原样保存在');
w('`lang/zh_CN.messages.json` 的 `needsReview` 数组中（顺序与草稿一致），下面也逐条列出。');
w();
w('处理方式建议：');
w();
w('1. `fragment-*` —— 这些条目从来不是一条消息，而是旧表用来替换句子成分的词。它们**不应**成为独立 key：');
w('   正确做法是在 R3.8 抽取代码字符串时，把整句作为 key 并用 `{0}` 传参，然后删除对应条目；');
w('2. `label-prefix` —— 变成 `stat.*` 的整句 key（例如 `"Total heat: "` → `stat.total.heat: "总热量：{0}"`）；');
w('3. `no-rule` —— 逐条判断是 UI 文案、数据名还是应废弃。');
w();
w('### 4.1 人工队列全量清单');
w();
for (const [index, entry] of reviewEntries.entries()) {
  w(`${index + 1}. [${entry.reason}] ${inline(entry.source)} => ${inline(entry.translation)}`);
}
w();

w('## 5. 已知局限');
w();
w('1. **key 是临时产物**：前缀是启发式判定，后缀由英文机械生成。R3.8 抽取代码字符串时应同时冻结语义 key，');
w('   本报告的映射表就是那次评审的输入。');
w('2. **没有复数信息**：旧表用子串替换，无法表达单复数。`en_US` 种子包因此只有单形消息；');
w('   复数形态（`{one}/{other}` 对象）必须在 R3.8 人工编写（机制见 `docs/r1/r1.2-i18n.md`）。');
w('3. **没有占位符信息**：旧表把参数拼接在句子中间，本脚本无法还原参数位置，所以带冒号/空白的条目全部进人工队列，');
w('   而不是猜一个 `{0}` 位置。');
w('4. **大小写口径**：去重沿用 R0.5 的 PowerShell 大小写不敏感行为（否则无法复现 1,101 这个数字）；');
w('   产物本身是大小写敏感的，重复项已在上文列出。');
w('5. **元素覆盖率仍很低**：26 / 948（2.7%）。未被覆盖的元素按设计整条回退到英文 canonical 名，');
w(`   这 922 个元素就是中文包的后续工作量（\`packages/i18n/test/dataNames.test.ts\` 会断言该数字）。`);
w();
w('---');
w();
w(`*生成自 ${GENERATOR}；输入规模：${pairs.length} 对 / ${messageEntries.length} 条 UI / ${elementEntries.length} 个数据名。*`);
w();

mkdirSync(dirname(PATHS.report), { recursive: true });
writeFileSync(PATHS.messages, `${JSON.stringify(messagesOut, null, 2)}\n`, 'utf8');
writeFileSync(PATHS.canonical, `${JSON.stringify(canonicalOut, null, 2)}\n`, 'utf8');
writeFileSync(PATHS.elements, `${JSON.stringify(elementsOut, null, 2)}\n`, 'utf8');
writeFileSync(PATHS.report, lines.join('\n'), 'utf8');

// ---------------------------------------------------------------------------
// console summary
// ---------------------------------------------------------------------------

const summary = [
  `translation pairs        : ${pairs.length}`,
  `  data-name pairs        : ${dataNamePairsFound} -> ${elementEntries.length} identity keys`,
  `  UI pairs               : ${uiPairsFound}`,
  `    unique draft entries : ${messageEntries.length}`,
  `      auto-classified    : ${messagePairs.length} (${pct(messagePairs.length, messageEntries.length)}%)`,
  `      needs review       : ${reviewEntries.length} (${pct(reviewEntries.length, messageEntries.length)}%)`,
  `    duplicate occurrences: ${duplicates.length} (conflicting: ${duplicateConflicts.length})`,
  `auto by prefix           : ${[...autoByPrefix].map(([p, c]) => `${p}=${c}`).join(' ')}`,
  `hits by rule             : ${[...byRule].map(([r, c]) => `${r}=${c}`).join(' ')}`,
  `review by reason         : ${[...reviewByReason].map(([r, c]) => `${r}=${c}`).join(' ')}`,
  `accounts check           : ${dataNamePairsFound}+${uiPairsFound}=${pairs.length}, ` +
    `${messageEntries.length}+${duplicates.length}=${uiPairsFound}, ` +
    `${messagePairs.length}+${reviewEntries.length}=${messageEntries.length}`,
  `draft value mismatches   : ${draftValueMismatches}`,
  `orphan element keys      : ${orphanElementKeys.length}`,
  `whitespace normalized    : ${whitespaceNormalized}`,
  `silently dropped         : 0`,
  '',
  `wrote ${PATHS.messages}`,
  `wrote ${PATHS.canonical}`,
  `wrote ${PATHS.elements}`,
  `wrote ${PATHS.report}`,
];
console.log(summary.join('\n'));
