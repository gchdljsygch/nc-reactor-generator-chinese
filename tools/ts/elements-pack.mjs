#!/usr/bin/env node
/**
 * R5.1 —— 生成完整的 zh_CN 元素名（数据名）语言包 `lang/zh_CN.elements.json`。
 *
 * 用法（在仓库根目录执行）：
 *
 *     node tools/ts/elements-pack.mjs            # 生成/更新语言包
 *     node tools/ts/elements-pack.mjs --check     # 只校验磁盘上的文件是否与生成结果一致（CI 用）
 *     node tools/ts/elements-pack.mjs --report    # 只打印覆盖率统计
 *
 * 输入（只读）
 * ------------
 *   datasets/ncpf-elements.jsonl              948 行、732 个唯一身份键的权威元素数据集
 *   lang/parts/zh_CN.names.part1..5.json      五份已完成的「英文显示名 -> 中文」分片
 *   lang/zh_CN.elements.json                  已发布的语言包；它在**键级**是权威的
 *
 * 输出
 * ----
 *   lang/zh_CN.elements.json                  排序键、2 空格缩进、末尾换行的完整语言包
 *
 * 契约（对齐 packages/i18n/src/pack.ts / dataNameBundle.ts）
 * ---------------------------------------------------------
 *   键   = `<config>/<cfgType>/<definition.type>|<definition.toString()>`
 *          —— 与 `packages/ncpf/src/identity.ts#identityKey` 完全同一格式，
 *          本脚本只复用该格式，不另造规则（旧的
 *          `tools/ts/migrate-legacy-translations.mjs` 也用同一拼法）。
 *   值   = 整条中文字符串，绝不做「半翻译」（查不到就整条回退英文规范名）。
 *   meta = 自由字段；`counts` 是对账用的统计，`note` 说明口径。
 *
 * 三次幂等（重要）
 * ----------------
 *   本脚本把「已发布的语言包」同时当作**键级覆盖表**读回来：某个键在包里的
 *   值与「分片推导值」不同时，包里的值胜出。因此
 *     - 第一次运行：26 条评审过的 R0 草稿覆盖掉分片值；
 *     - 之后每次运行：包里已经写好的 732 条自洽，覆盖集合稳定不变；
 *     - 人工手改包中某条值后重跑，改动会被保留（`--check` 通过）。
 *   这条规则就是「已有 26 条权威」在脚本里的落地方式，见 RESOLUTIONS 的
 *   `pack-authority` 说明。
 *
 * 冲突策略（fail loudly）
 * -----------------------
 *   1. 同一个英文显示名在分片里出现多种中文 —— 必须由 RESOLUTIONS 裁决，否则退出码 1；
 *   2. 同一个身份键得到多种中文（分片值 vs 包值） —— 由 `pack-authority` 规则裁决，
 *      但每条都会打印出候选与来源；
 *   3. 裁决后仍残留被否决写法（forbidden 正则命中） —— 退出码 1；
 *   4. 覆盖率 < 98% —— 退出码 1（可用 --allow-incomplete 降级，仅用于排查）。
 *
 * 不许发明译文：所有中文都来自 `lang/parts/*.json` 或已发布的
 * `lang/zh_CN.elements.json`，脚本只做「选一个 + 统一术语写法」。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PATHS = {
  elementDump: join(ROOT, 'datasets/ncpf-elements.jsonl'),
  pack: join(ROOT, 'lang/zh_CN.elements.json'),
  parts: [1, 2, 3, 4, 5].map((n) => join(ROOT, `lang/parts/zh_CN.names.part${n}.json`)),
};

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const REPORT_ONLY = argv.includes('--report');
const ALLOW_INCOMPLETE = argv.includes('--allow-incomplete');
const COVERAGE_GATE = 0.98;

/** 与 `packages/ncpf/src/identity.ts#identityKey` 同一拼法。 */
const identityKey = (config, cfgType, type, definition) =>
  `${config}/${cfgType}/${type}|${definition}`;

/**
 * ===========================================================================
 * 术语裁决表（RESOLUTION TABLE）
 * ===========================================================================
 *
 * 每条记录的字段：
 *   term        英文概念（出现多种中文写法的那一个）
 *   canonical   采用的中文形式（会写进语言包）
 *   candidates  候选写法 + 来源 + 判定；报告里逐条打印（出现次数由脚本从
 *               `lang/parts/*.json` 里现算，不手写）
 *   rewrite     可选：对所有「来自分片」的值做的全局替换（统一术语写法）
 *   forbidden   可选：最终包里不得再出现的正则（残留即退出码 1）
 *   rationale   一句话理由
 *
 * 只有「显示名冲突」和「键冲突」才需要裁决；`rewrite` 用于把同一个概念的
 * 变体写法在整个包里统一掉。没有列在这里的术语**不做任何改动**。
 *
 * 选型依据的优先级：
 *   A. `lang/zh_CN.elements.json` 已发布的 26 条（R0 评审过，键级绝对权威）；
 *   B. `lang/zh_CN.messages.json`（R1.2f 迁移产物，1101 条 UI 文案）；
 *   C. `datasets/translations/legacy-translations.json`（Java 版 1185 条词条，
 *      即 NuclearCraft 社区/官方中文的实际用语）；
 *   D. `lang/parts/*.json`（本次的分片译文，同一术语取包内多数形式）。
 *
 * 额外发现（任务给的清单之外）：Liquid Helium / Liquid Nitrogen 在分片里各有
 * 两种写法（液氦 vs 液态氦、液氮 vs 液态氮），同样按「一个概念一种写法」统一。
 */
const RESOLUTIONS = [
  {
    term: 'NaK',
    canonical: '钠钾合金',
    candidates: [
      {
        value: '钠钾合金',
        source:
          'lang/parts/zh_CN.names.part3/part4.json（全部 NaK 条目）+ ' +
          'legacy-translations.json `NaK => 钠钾合金`、`Hot NaK => 高温钠钾合金`',
        verdict: 'adopted',
      },
      {
        value: '钠钾共晶合金',
        source: '任务清单里提到的候选；五个分片文件中出现 0 次',
        verdict: 'rejected',
      },
    ],
    forbidden: [/钠钾共晶合金/],
    rationale:
      'NaK 是钠钾合金的缩写，展开即「钠钾合金」；「共晶」由独立词 Eutectic 承担' +
      '（legacy `Eutectic => 共晶`），故 Hot Eutectic NaK Alloy = 高温共晶钠钾合金，' +
      '既不重复也不残留 Latin。',
  },
  {
    term: 'Coolant',
    canonical: '冷却剂',
    rewrite: { from: /冷却液/g, to: '冷却剂' },
    candidates: [
      {
        value: '冷却剂',
        source:
          'lang/parts/zh_CN.names.part4.json + lang/zh_CN.messages.json（10 处）+ ' +
          'legacy-translations.json `Coolant => 冷却剂`、`Coolant Heater => 冷却剂加热器`',
        verdict: 'adopted',
      },
      {
        value: '冷却液',
        source:
          'lang/parts/zh_CN.names.part3.json（多数条目）+ lang/zh_CN.app.json 的 ' +
          'meta.glossary「Coolant」',
        verdict: 'rejected',
      },
    ],
    forbidden: [/冷却液/],
    rationale:
      'legacy 词表与 zh_CN.messages.json 一致用「冷却剂」，且 part4 的 54 条也用它；' +
      'lang/zh_CN.app.json 的术语表写的是「冷却液」，但该文件本次不可修改，' +
      '已记入 docs/r5/glossary.md 的待统一项。',
  },
  {
    term: 'Cryotheum',
    canonical: '极寒之凛冰',
    rewrite: { from: /极寒之凛(?!冰)/g, to: '极寒之凛冰' },
    candidates: [
      {
        value: '极寒之凛冰',
        source:
          'lang/zh_CN.elements.json 的 `legacy_fluid|cryotheum`（已发布，权威）+ ' +
          'legacy-translations.json `Cryotheum => 极寒之凛冰` + part5（Molten Cryotheum / Cryotheum Cooler）',
        verdict: 'adopted',
      },
      {
        value: '极寒之凛',
        source: 'part1（Cryotheum Heat Sink）、part3（Cryotheum Coolant Heater 等）',
        verdict: 'rejected',
      },
    ],
    forbidden: [/极寒之凛(?!冰)/],
    rationale:
      '已发布语言包与 legacy 词表都写「极寒之凛冰」，分片的「极寒之凛」是短写；' +
      '替换时用 (?!冰) 负向断言避免出现「极寒之凛冰冰」。',
  },
  {
    term: 'Enderium',
    canonical: '末影合金',
    rewrite: { from: /末影金属/g, to: '末影合金' },
    candidates: [
      {
        value: '末影合金',
        source:
          'legacy-translations.json `Enderium => 末影合金` + part5（Enderium Cooler）',
        verdict: 'adopted',
      },
      {
        value: '末影金属',
        source: 'part1（Enderium Heat Sink）、part3（Enderium Coolant Heater / NaK 混合物）',
        verdict: 'rejected',
      },
    ],
    forbidden: [/末影金属/],
    rationale:
      'legacy 词表把 Enderium 定为「末影合金」（末影+合金），与 `Alloy => 合金` 自洽；' +
      '「末影金属」是另一种直译，分片里只有少数条目用。注意 Ender（末影）与 Enderium 是两个概念。',
  },
  {
    term: 'Fluorite',
    canonical: '氟石',
    candidates: [
      {
        value: '氟石',
        source: 'part1（Fluorite Heat Sink）、part3（Fluorite Coolant Heater ×3、NaK-Fluorite）',
        verdict: 'adopted',
      },
      {
        value: '萤石',
        source: 'legacy-translations.json `Fluorite => 萤石`（单条）',
        verdict: 'rejected',
      },
    ],
    forbidden: [],
    rationale:
      '萤石 已经是 Glowstone 的定型译名（已发布包 `legacy_fluid|glowstone = 萤石`，权威，' +
      '五个分片也一致），若 Fluorite 同样写作「萤石」，两种不同物质在规划器里会同名；' +
      '「氟石」是 CaF2 的行业同义名，分片也一致使用。故这里刻意不采用 legacy 的孤例。',
  },
  {
    term: 'Glowstone',
    canonical: '萤石',
    candidates: [
      {
        value: '萤石',
        source:
          'lang/zh_CN.elements.json `legacy_fluid|glowstone`（权威）+ 五个分片 + ' +
          'legacy-translations.json `Glowstone => 萤石`',
        verdict: 'adopted',
      },
      {
        value: '荧石',
        source: '任务清单里提到的候选；仓库中出现 0 次',
        verdict: 'rejected',
      },
    ],
    forbidden: [/荧石/],
    rationale: '仓库四个来源一致写「萤石」，没有任何地方用「荧石」。',
  },
  {
    term: 'Slime',
    canonical: '史莱姆',
    candidates: [
      {
        value: '史莱姆',
        source:
          'legacy-translations.json `Slime => 史莱姆` + part2（Slime Heat Sink）、part4（NaK-Slime、Slime Coolant Heater ×3）',
        verdict: 'adopted',
      },
    ],
    forbidden: [],
    rationale: '沿用 legacy 词表与全部分片的 Minecraft 惯用译名。',
  },
  {
    term: 'Solid Fission Controller',
    canonical: '固体裂变控制器',
    candidates: [
      {
        value: '固体裂变控制器',
        source:
          'part2 + legacy-translations.json `Solid => 固体`、`Overhaul SFR => 改版固体燃料堆`',
        verdict: 'adopted',
      },
      {
        value: '固态裂变控制器',
        source: '任务清单里提到的候选；仓库中出现 0 次',
        verdict: 'rejected',
      },
    ],
    forbidden: [/固态/],
    rationale:
      'legacy 与 zh_CN.messages.json 一律用「固体」（固体燃料堆 ↔ 熔盐堆），故 Solid = 固体。',
  },
  {
    term: 'Protactinium-Enriched Thorium Dust',
    canonical: '富集镤钍粉末',
    candidates: [
      {
        value: '富集镤钍粉末',
        source: 'lang/parts/zh_CN.names.part4.json',
        verdict: 'adopted',
      },
      {
        value: '富镤钍粉末',
        source: 'lang/parts/zh_CN.names.part2.json',
        verdict: 'rejected',
      },
      {
        value: '浓缩镤钍粉末',
        source: 'legacy-translations.json `Enriched => 浓缩`（只是单词条，没有这条整名）',
        verdict: 'rejected',
      },
    ],
    forbidden: [],
    rationale:
      '「富集」是核燃料循环里 enriched 的固定动词（与包内 `Depleted => 贫化` 对仗），' +
      'part4 保留了这个动词，part2 的「富镤钍」把它丢了；legacy 的 `Enriched => 浓缩` ' +
      '是单词条、两个分片都没用，不采纳（见交付说明的「未验证」一节）。',
  },
  {
    term: 'Reactor Cell',
    canonical: '燃料单元',
    candidates: [
      {
        value: '燃料单元',
        source:
          'lang/zh_CN.elements.json `Underhaul SFR Configuration/legacy_block|nuclearcraft:cell_block`' +
          '（已发布，权威）+ 数据集该元素的 legacy 别名 "Fuel Cell" + ' +
          'legacy-translations.json `Fuel Cell => 燃料单元`',
        verdict: 'adopted',
      },
      {
        value: '反应堆单元',
        source: 'lang/parts/zh_CN.names.part5.json',
        verdict: 'rejected',
      },
    ],
    forbidden: [/反应堆单元/],
    rationale:
      '这个键是旧版 SFR 的燃料单元方块（数据集 canonical display 为 Reactor Cell，' +
      '别名 Fuel Cell），已发布包定为「燃料单元」，与 app 层 stat.cells/totalFuelCells 一致。',
  },
  {
    term: 'SiC-SiC CMC Rotor Blade',
    canonical: 'SiC-SiC CMC 转子叶片',
    candidates: [
      {
        value: 'SiC-SiC CMC 转子叶片',
        source: 'lang/parts/zh_CN.names.part5.json',
        verdict: 'adopted',
      },
      {
        value: '碳化硅-碳化硅陶瓷基复合材料转子叶片',
        source:
          'legacy-translations.json 只把裸词 `SiC => 碳化硅` 单列，没有复合材料名',
        verdict: 'rejected',
      },
    ],
    forbidden: [],
    rationale:
      'SiC-SiC CMC 是复合材料的缩略语链，中文材料文献里通常保持 Latin；' +
      '叶片部分沿用 legacy `Blade => 叶片`。全包只有这一条含 SiC。',
  },
  {
    term: 'Liquid Helium',
    canonical: '液态氦',
    rewrite: { from: /液氦/g, to: '液态氦' },
    candidates: [
      {
        value: '液态氦',
        source: 'part5（Liquid Helium、Liquid Helium Cooler）',
        verdict: 'adopted',
      },
      { value: '液氦', source: 'part2（Liquid Helium Heat Sink）', verdict: 'rejected' },
    ],
    forbidden: [/液氦/],
    rationale:
      '清单之外的额外发现：同一概念在分片里有两种写法，按包内多数并与「液态氮」保持' +
      '一致的「液态X」结构统一。',
  },
  {
    term: 'Liquid Nitrogen',
    canonical: '液态氮',
    rewrite: { from: /液氮/g, to: '液态氮' },
    candidates: [
      {
        value: '液态氮',
        source: 'part4（Liquid Nitrogen Coolant Heater ×3）',
        verdict: 'adopted',
      },
      { value: '液氮', source: 'part2（Liquid Nitrogen Heat Sink）', verdict: 'rejected' },
    ],
    forbidden: [/液氮/],
    rationale: '同上：与「液态氦」配对统一为「液态X」。',
  },
];

/**
 * 键级权威规则：`lang/zh_CN.elements.json` 里已发布的值优先于分片推导值。
 * 这条规则覆盖所有「键冲突」，它本身是任务给定的契约（26 条已评审），所以脚本
 * 不会因为它报错；但每一条冲突的候选与来源都会打印出来，便于人工复核。
 *
 * 已知的 14 条键级差异（脚本每次运行都会现算并打印）：
 *   - 13 条 underhaul 熔融流体：已发布包是「铜/铁/红石/…」，分片是「熔融铜/熔融铁/…」；
 *   - 1 条 `oredict|blockFissionModerator`：已发布包是「石墨」，分片（display=Moderator）是「慢化剂」。
 * 这 14 条是 R0 用 legacy 子串机制迁移出来的产物（`Copper => 铜`、`Graphite => 石墨`
 * 是该元素 legacy 别名表里的短名），已发布包既已评审就照用；如需改成「熔融铜」「慢化剂」，
 * 直接手改 `lang/zh_CN.elements.json` 后重跑本脚本即可（包即覆盖表，改动会被保留）。
 */
const PACK_AUTHORITY = {
  id: 'pack-authority',
  source: 'lang/zh_CN.elements.json',
  rationale: '已发布的 26 条是 R0 评审过的权威值，键级冲突时胜出。',
};

/** 键级覆盖里允许被丢弃的孤儿键（已发布包里有、数据集里没有的键）。当前为空。 */
const ORPHAN_ALLOWLIST = new Set([]);

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const displayName = (row) => row.display ?? '';

/** 与 legacy-translations 一致：英文显示名的「词尾」用于诊断分组。 */
function tailWords(name, count = 2) {
  const stripped = name.replace(/\s*\([^)]*\)\s*$/u, ' ').trim();
  const words = stripped.split(/\s+/u);
  return words.slice(-count).join(' ');
}

function longestCommonSuffix(a, b) {
  let n = 0;
  while (n < Math.min(a.length, b.length) && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return a.slice(a.length - n);
}

const CJK_ONLY = /^[\u3400-\u9fff]+$/u;

// ---------------------------------------------------------------------------
// 1. 数据集
// ---------------------------------------------------------------------------

if (!existsSync(PATHS.elementDump)) {
  console.error(`未找到数据集：${PATHS.elementDump}`);
  process.exit(1);
}

const rows = readFileSync(PATHS.elementDump, 'utf8')
  .split(/\r?\n/u)
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line))
  .filter((row) => row.__meta === undefined);

/** 身份键 -> 数据集行（首次出现的行胜出；数据集里 216 行是重复行，键与 display 都相同）。 */
const datasetRows = new Map();
const keyFormatMismatches = [];
for (const row of rows) {
  const key = identityKey(row.config, row.cfgType, row.type, row.def);
  if (`${row.config}/${row.cfgType}/${row.identity}` !== key) {
    keyFormatMismatches.push({ key, identity: row.identity });
  }
  if (!datasetRows.has(key)) datasetRows.set(key, row);
}

const datasetDisplays = new Set([...datasetRows.values()].map(displayName));

// ---------------------------------------------------------------------------
// 2. 分片译文（并就地统一术语写法）
// ---------------------------------------------------------------------------

const parts = PATHS.parts.map((path, index) => {
  if (!existsSync(path)) {
    console.error(`未找到分片文件：${path}`);
    process.exit(1);
  }
  const data = readJson(path);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    console.error(`分片 ${path} 必须是 { 英文显示名: 中文 } 的 JSON 对象`);
    process.exit(1);
  }
  return { path, label: `lang/parts/zh_CN.names.part${index + 1}.json`, data };
});

const termRules = RESOLUTIONS.filter((rule) => rule.rewrite !== undefined);
const rewriteLog = [];

function applyTermRewrites(value, label, display) {
  let out = value;
  for (const rule of termRules) {
    const before = out;
    out = out.replace(rule.rewrite.from, rule.rewrite.to);
    if (out !== before) rewriteLog.push({ term: rule.term, label, display, before, after: out });
  }
  return out;
}

/** 英文显示名 -> [{ value, source }]（已做术语统一）。 */
const displayCandidates = new Map();
const nonStringValues = [];
for (const part of parts) {
  for (const [display, raw] of Object.entries(part.data)) {
    if (typeof raw !== 'string') {
      nonStringValues.push({ label: part.label, display, value: raw });
      continue;
    }
    const value = applyTermRewrites(raw, part.label, display);
    if (!displayCandidates.has(display)) displayCandidates.set(display, []);
    displayCandidates.get(display).push({ value, source: part.label });
  }
}

// ---------------------------------------------------------------------------
// 3. 冲突检测（显示名级）
// ---------------------------------------------------------------------------

/**
 * 裁决表里，凡是 `term` 本身就是某个分片里的完整英文显示名的，就是「显示名级裁决」；
 * 其余（NaK / Coolant / …）是术语级重写，靠 `rewrite` 生效。
 */
const displayResolutions = new Map(
  RESOLUTIONS.filter((rule) => parts.some((part) => rule.term in part.data)).map((rule) => [
    rule.term,
    rule,
  ]),
);

/** 显示名 -> 最终中文。 */
const displayValue = new Map();
const displayConflicts = [];
const unresolvedDisplayConflicts = [];

for (const [display, list] of displayCandidates) {
  const byValue = new Map();
  for (const candidate of list) {
    if (!byValue.has(candidate.value)) byValue.set(candidate.value, []);
    byValue.get(candidate.value).push(candidate.source);
  }
  if (byValue.size === 1) {
    displayValue.set(display, [...byValue.keys()][0]);
    continue;
  }
  const conflict = {
    display,
    candidates: [...byValue.entries()].map(([value, sources]) => ({ value, sources })),
  };
  const rule = displayResolutions.get(display);
  if (rule === undefined) {
    unresolvedDisplayConflicts.push(conflict);
    continue;
  }
  conflict.resolvedBy = rule.term;
  conflict.chosen = rule.canonical;
  displayConflicts.push(conflict);
  displayValue.set(display, rule.canonical);
}

/**
 * 裁决表里点名的显示名**无条件**生效（即使分片之间没有分歧），这样
 * 「Reactor Cell -> 燃料单元」这类裁决不依赖已发布包的键级覆盖也能成立。
 */
const forcedDisplays = [];
for (const [display, rule] of displayResolutions) {
  if (!displayCandidates.has(display)) continue;
  if (displayValue.get(display) !== rule.canonical) {
    forcedDisplays.push({ display, from: displayValue.get(display), to: rule.canonical });
  }
  displayValue.set(display, rule.canonical);
}

// 分片里有、数据集里没有的显示名：报为 extra，不静默丢弃。
const extraDisplays = [...displayCandidates.keys()].filter((d) => !datasetDisplays.has(d)).sort();

// ---------------------------------------------------------------------------
// 4. 键级合并（已发布包优先）
// ---------------------------------------------------------------------------

const packDoc = existsSync(PATHS.pack) ? readJson(PATHS.pack) : { elements: {} };
const packElements = packDoc.elements ?? {};

const entries = new Map();
const keyConflicts = [];
const missingKeys = [];
const missingDisplays = new Set();

for (const [key, row] of datasetRows) {
  const display = displayName(row);
  const fromParts = displayValue.has(display) ? displayValue.get(display) : undefined;
  if (fromParts === undefined) missingDisplays.add(display);

  const candidates = [];
  if (fromParts !== undefined) {
    candidates.push({ value: fromParts, source: `parts（display "${display}"）` });
  }
  const fromPack = typeof packElements[key] === 'string' ? packElements[key] : undefined;
  if (fromPack !== undefined) {
    candidates.push({ value: fromPack, source: 'lang/zh_CN.elements.json（已发布）' });
  }

  const distinct = [...new Set(candidates.map((c) => c.value))];
  if (distinct.length > 1) {
    keyConflicts.push({ key, display, candidates, chosen: fromPack, resolvedBy: PACK_AUTHORITY.id });
  }

  const chosen = fromPack ?? fromParts;
  if (chosen === undefined) {
    missingKeys.push({ key, display });
    continue;
  }
  entries.set(key, chosen);
}

// 已发布包里的孤儿键（数据集里没有的身份键）。
const orphanKeys = Object.keys(packElements)
  .filter((key) => !datasetRows.has(key))
  .sort();
const fatalOrphans = orphanKeys.filter((key) => !ORPHAN_ALLOWLIST.has(key));

// ---------------------------------------------------------------------------
// 5. 裁决后的兜底校验：被否决写法不得残留
// ---------------------------------------------------------------------------

/**
 * 候选写法在源头/成品里的出现次数（现算，不手写）。
 * 弃用候选如果被某条 forbidden 正则精确描述（例如「极寒之凛」不是
 * 「极寒之凛冰」的一部分），就用那条正则统计，否则用子串统计。
 */
function matcherFor(rule, candidate) {
  const precise = (rule.forbidden ?? []).find((pattern) => pattern.test(candidate.value));
  return precise === undefined
    ? (text) => text.includes(candidate.value)
    : (text) => precise.test(text);
}

const termCensus = RESOLUTIONS.map((rule) => {
  const counts = rule.candidates.map((candidate) => ({
    value: candidate.value,
    verdict: candidate.verdict,
    source: candidate.source,
    inParts: 0,
    inPack: 0,
    match: matcherFor(rule, candidate),
  }));
  for (const part of parts) {
    for (const raw of Object.values(part.data)) {
      if (typeof raw !== 'string') continue;
      for (const row of counts) {
        if (row.match(raw)) row.inParts += 1;
      }
    }
  }
  for (const value of entries.values()) {
    for (const row of counts) {
      if (row.match(value)) row.inPack += 1;
    }
  }
  return { term: rule.term, canonical: rule.canonical, counts };
});

const survivingForbidden = [];
for (const rule of RESOLUTIONS) {
  for (const pattern of rule.forbidden ?? []) {
    for (const [key, value] of entries) {
      if (pattern.test(value)) survivingForbidden.push({ term: rule.term, key, value, pattern: String(pattern) });
    }
  }
}

/**
 * 非阻塞的术语一致性提示：按英文词尾分组，若同组译文在「组内公共后缀」之外
 * 仍有 ≥2 个纯中文变体（说明某个词被译成了两种写法），列出来供人工复核。
 * 这些不影响退出码 —— 已在 RESOLUTIONS 里裁决过的写法不会命中。
 */
const termHints = [];
{
  const groups = new Map();
  for (const [display, value] of displayValue) {
    const tail = tailWords(display);
    if (!groups.has(tail)) groups.set(tail, new Map());
    groups.get(tail).set(display, value);
  }
  for (const [tail, group] of groups) {
    if (group.size < 2) continue;
    const values = [...group.values()];
    let common = values[0];
    for (const value of values) common = longestCommonSuffix(common, value);
    const remainders = values
      .map((value) => value.slice(0, value.length - common.length))
      .filter((remainder) => CJK_ONLY.test(remainder));
    if (remainders.length < 2) continue;
    let shared = remainders[0];
    for (const remainder of remainders) shared = longestCommonSuffix(shared, remainder);
    if (shared.length >= 2 && new Set(remainders).size > 1) {
      termHints.push({ tail, shared, variants: [...new Set(remainders)].sort() });
    }
  }
}

// ---------------------------------------------------------------------------
// 6. 覆盖率
// ---------------------------------------------------------------------------

const totalKeys = datasetRows.size;
const coveredKeys = entries.size;
const coverage = totalKeys === 0 ? 0 : coveredKeys / totalKeys;
const coveredRows = rows.filter((row) =>
  entries.has(identityKey(row.config, row.cfgType, row.type, row.def)),
).length;

// ---------------------------------------------------------------------------
// 7. 输出文档
// ---------------------------------------------------------------------------

const sortedEntries = [...entries.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

const out = {
  meta: {
    locale: 'zh_CN',
    name: '简体中文',
    version: '0.4.0-r5.1',
    base: 'en_US',
    status: 'complete',
    generatedBy: 'tools/ts/elements-pack.mjs',
    identityFormat: '<config>/<cfgType>/<definition.type>|<definition.toString()>',
    sources: [
      'datasets/ncpf-elements.jsonl',
      'lang/parts/zh_CN.names.part1..5.json',
      'lang/zh_CN.elements.json（键级权威覆盖，优先于分片）',
    ],
    counts: {
      datasetRows: rows.length,
      identityKeys: totalKeys,
      coveredKeys,
      missingKeys: missingKeys.length,
      coveragePercent: Number((coverage * 100).toFixed(2)),
      translatedDisplayNames: displayValue.size,
      displayNames: datasetDisplays.size,
      authoritativeOverrides: keyConflicts.length,
      conflictsResolved: displayConflicts.length + keyConflicts.length,
      termRewrites: rewriteLog.length,
    },
    note:
      'R5.1 由 tools/ts/elements-pack.mjs 生成：分片译文（lang/parts/*）按英文显示名展开成' +
      '四段式身份键，已发布的 26 条在键级优先，术语按脚本内的 RESOLUTIONS 表统一。' +
      '键序固定排序、2 空格缩进。运行方式：node tools/ts/elements-pack.mjs [--check|--report]。',
  },
  elements: Object.fromEntries(sortedEntries),
};

const serialized = `${JSON.stringify(out, null, 2)}\n`;

// ---------------------------------------------------------------------------
// 8. 报告
// ---------------------------------------------------------------------------

const say = (...args) => console.log(...args);
const fail = (...args) => console.error(...args);

if (!REPORT_ONLY) {
  say('zh_CN 元素名语言包 / elements-pack');
  say('  术语裁决表（RESOLUTIONS）');
  for (const rule of RESOLUTIONS) {
    const census = termCensus.find((c) => c.term === rule.term);
    say(`    - ${rule.term} -> ${rule.canonical}`);
    for (const row of census.counts) {
      say(
        `        [${row.verdict === 'adopted' ? '采用' : '弃用'}] ${row.value}` +
          `  parts 命中 ${row.inParts} 条 / 成品命中 ${row.inPack} 条` +
          `  <- ${row.source}`,
      );
    }
    if (rule.rewrite) {
      const hits = rewriteLog.filter((h) => h.term === rule.term);
      say(`        重写 ${hits.length} 处：${rule.rewrite.from} -> ${rule.rewrite.to}`);
    }
  }

  say('');
  say(`  分片文件：${parts.map((p) => p.label).join(', ')}`);
  say(`  数据集：${rows.length} 行 / ${totalKeys} 个唯一身份键（${rows.length - totalKeys} 行重复）`);
  say(`  显示名：数据集 ${datasetDisplays.size} 个，分片覆盖 ${displayValue.size} 个`);

  if (keyFormatMismatches.length > 0) {
    fail(`  ERROR 数据集里 ${keyFormatMismatches.length} 行的 identity 与 <type>|<def> 不一致`);
  }
  if (nonStringValues.length > 0) {
    fail(`  ERROR ${nonStringValues.length} 个分片值不是字符串`);
  }

  if (displayConflicts.length > 0) {
    say('');
    say(`  显示名冲突（已由 RESOLUTIONS 裁决，${displayConflicts.length} 条）`);
    for (const conflict of displayConflicts) {
      say(`    - "${conflict.display}"`);
      for (const candidate of conflict.candidates) {
        say(`        ${candidate.value}  <- ${candidate.sources.join(', ')}`);
      }
      say(`      裁决：${conflict.chosen}（${conflict.resolvedBy}）`);
    }
  }

  if (forcedDisplays.length > 0) {
    say('');
    say(`  显示名级裁决（无条件生效，${forcedDisplays.length} 条）`);
    for (const forced of forcedDisplays) {
      say(`    - "${forced.display}"：${forced.from} -> ${forced.to}`);
    }
  }

  if (unresolvedDisplayConflicts.length > 0) {
    fail('');
    fail(`  ERROR 未裁决的显示名冲突 ${unresolvedDisplayConflicts.length} 条：`);
    for (const conflict of unresolvedDisplayConflicts) {
      fail(`    - "${conflict.display}"`);
      for (const candidate of conflict.candidates) {
        fail(`        ${candidate.value}  <- ${candidate.sources.join(', ')}`);
      }
    }
    fail('    请在上表的 RESOLUTIONS 里补一条裁决。');
  }

  if (keyConflicts.length > 0) {
    say('');
    say(
      `  键冲突（分片值与已发布包不一致，按 ${PACK_AUTHORITY.id} 取已发布值，${keyConflicts.length} 条）`,
    );
    for (const conflict of keyConflicts) {
      const partsValue = conflict.candidates.find((c) => c.source.startsWith('parts'));
      const packValue = conflict.candidates.find((c) => c.source.startsWith('lang/'));
      say(`    - ${conflict.key}`);
      say(`        分片：${partsValue?.value ?? '<无>'}  |  已发布包：${packValue?.value ?? '<无>'}  => ${conflict.chosen}`);
    }
    say(`    依据：${PACK_AUTHORITY.rationale}`);
  }

  if (rewriteLog.length > 0) {
    say('');
    say(`  术语统一重写 ${rewriteLog.length} 处（明细如下，按术语聚合）`);
    const byTerm = new Map();
    for (const hit of rewriteLog) {
      if (!byTerm.has(hit.term)) byTerm.set(hit.term, []);
      byTerm.get(hit.term).push(hit);
    }
    for (const [term, hits] of byTerm) {
      say(`    - ${term}: ${hits.length} 处，例如 "${hits[0].before}" -> "${hits[0].after}"`);
    }
  }

  if (extraDisplays.length > 0) {
    say('');
    say(`  EXTRA：分片里有、数据集里没有的显示名 ${extraDisplays.length} 个（不会写进成品）`);
    for (const display of extraDisplays) say(`    - "${display}"`);
    say(
      '    判定：数据集来自 ElementDump（从模组配置导出，权威），分片是手工译文；' +
        '出现 EXTRA 说明分片超前于数据集或写错了名字，需人工与数据集对齐。',
    );
  }

  if (fatalOrphans.length > 0) {
    fail('');
    fail(`  ERROR 已发布包里有 ${fatalOrphans.length} 个数据集里不存在的孤儿键：`);
    for (const key of fatalOrphans) fail(`    - ${key}`);
    fail('    请确认身份键格式，或把该键显式加入 ORPHAN_ALLOWLIST。');
  }

  if (survivingForbidden.length > 0) {
    fail('');
    fail(`  ERROR 裁决后被否决的写法仍然残留 ${survivingForbidden.length} 处：`);
    for (const hit of survivingForbidden) {
      fail(`    - ${hit.term} 的 ${hit.pattern} 命中 ${hit.key} = "${hit.value}"`);
    }
  }

  if (termHints.length > 0) {
    say('');
    say(`  术语一致性提示（非阻塞，${termHints.length} 组）：同组译文在公共后缀之外仍有多种写法`);
    for (const hint of termHints) {
      say(`    - 词尾 "${hint.tail}"（公共 "${hint.shared}"）：${hint.variants.join(' / ')}`);
    }
  }
}

say('');
say('  覆盖率');
say(`    身份键：${coveredKeys} / ${totalKeys} = ${(coverage * 100).toFixed(2)}%`);
say(`    数据集行：${coveredRows} / ${rows.length} = ${((coveredRows / rows.length) * 100).toFixed(2)}%`);
say(`    缺失键：${missingKeys.length}，冲突已裁决：${displayConflicts.length + keyConflicts.length}`);
if (missingDisplays.size > 0) {
  say(`    没有译文的数据集显示名（${missingDisplays.size} 个）：`);
  for (const display of [...missingDisplays].sort()) say(`      - "${display}"`);
}
if (missingKeys.length > 0) {
  say(`    未覆盖的身份键（${missingKeys.length} 个）：`);
  for (const entry of missingKeys) say(`      - ${entry.key}  (display "${entry.display}")`);
}
if (rewriteLog.length > 0 && !REPORT_ONLY) {
  say(`    术语统一重写：${rewriteLog.length} 处`);
}

const hardFailure =
  unresolvedDisplayConflicts.length > 0 ||
  fatalOrphans.length > 0 ||
  survivingForbidden.length > 0 ||
  keyFormatMismatches.length > 0 ||
  nonStringValues.length > 0 ||
  (!ALLOW_INCOMPLETE && coverage < COVERAGE_GATE);

if (REPORT_ONLY) {
  if (hardFailure) {
    fail('');
    fail(`elements-pack --report FAILED（覆盖率 ${(coverage * 100).toFixed(2)}% / 阈值 ${COVERAGE_GATE * 100}%）`);
    process.exit(1);
  }
  say('');
  say('elements-pack --report OK（未写文件）');
  process.exit(0);
}

if (CHECK) {
  const current = existsSync(PATHS.pack) ? readFileSync(PATHS.pack, 'utf8') : undefined;
  if (current === undefined) {
    fail('');
    fail(`elements-pack --check FAILED：${PATHS.pack} 不存在`);
    process.exit(1);
  }
  if (current !== serialized) {
    const a = current.split('\n');
    const b = serialized.split('\n');
    const at = a.findIndex((line, i) => line !== b[i]);
    fail('');
    fail(`elements-pack --check FAILED：lang/zh_CN.elements.json 与生成结果不一致（首个差异在第 ${at + 1} 行）`);
    fail(`  磁盘：${a[at] ?? '<EOF>'}`);
    fail(`  生成：${b[at] ?? '<EOF>'}`);
    fail('  修复：运行 node tools/ts/elements-pack.mjs');
    process.exit(1);
  }
  if (hardFailure) {
    fail('');
    fail('elements-pack --check FAILED（文件一致，但存在未裁决冲突/覆盖率不足）');
    process.exit(1);
  }
  say('');
  say(`elements-pack --check OK：lang/zh_CN.elements.json 与生成结果一致（${coveredKeys} 条）`);
  process.exit(0);
}

if (hardFailure) {
  fail('');
  fail(
    `elements-pack FAILED：未裁决冲突 ${unresolvedDisplayConflicts.length}、孤儿键 ${fatalOrphans.length}、` +
      `残留写法 ${survivingForbidden.length}、覆盖率 ${(coverage * 100).toFixed(2)}%（阈值 ${COVERAGE_GATE * 100}%）`,
  );
  process.exit(1);
}

const before = existsSync(PATHS.pack) ? readFileSync(PATHS.pack, 'utf8') : undefined;
if (before === serialized) {
  say('');
  say(`未变化：${PATHS.pack} 已经是生成结果（${coveredKeys} 条）`);
} else {
  writeFileSync(PATHS.pack, serialized, 'utf8');
  say('');
  say(`已写入 lang/zh_CN.elements.json（${coveredKeys} 条，${before === undefined ? '新建' : '更新'}）`);
}
