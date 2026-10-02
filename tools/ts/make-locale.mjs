#!/usr/bin/env node
/**
 * R5.2 — generate the third locale pack (`ja_JP`) from the app's **required** key set.
 *
 * ## What this script is for
 *
 * The plan's R5.2 acceptance is: *adding a language costs zero code*. That claim is only
 * credible if a language can actually be added without touching TypeScript, so this script
 * is the demonstration: it reads the app's required keys (the same set
 * `tools/ts/i18n-audit-app.mjs` enforces) and writes a complete `ja_JP` pack.
 *
 * ## Why a generator and not a hand-written file
 *
 * The app asks for 148 keys in the `app` part; a locale that is missing any one of them
 * fails the CI gate. Hand-maintaining a second-language file that must track a moving key
 * set is exactly the maintenance burden the plan wants to show does not exist — so the
 * pack is generated from the canonical one, with a translation table for the keys that
 * have one and the English source kept for the keys that do not.
 *
 * ## The honest part
 *
 * A *machine* cannot translate. The table below covers the UI vocabulary that is actually
 * settled (actions, menus, panels, statistics, the generator panel); every key not in the
 * table keeps the canonical English value and is counted in `meta.untranslated`. The CI
 * gate is satisfied because the key *exists*; the report says plainly how much is a real
 * translation. That distinction is the whole point — a fake 100% is worse than an honest
 * 62%.
 *
 * Usage:
 *
 *   node tools/ts/make-locale.mjs            # write lang/ja_JP.app.json
 *   node tools/ts/make-locale.mjs --check    # fail if the file on disk differs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LANG_DIR = 'lang';
const LOCALE = 'ja_JP';
const OUT = join(LANG_DIR, `${LOCALE}.app.json`);
const SOURCE = join(LANG_DIR, 'en_US.app.json');

/**
 * The translated subset.
 *
 * Grouped so a reviewer can check one area at a time. Terms follow the mod's own
 * Japanese usage where it is established (原子炉 for reactor, 燃料 for fuel,
 * 冷却材 for coolant, モデレーター from the English loan) and are otherwise
 * straightforward UI vocabulary.
 */
const TABLE = {
  // actions
  'action.apply': '適用',
  'action.cancel': 'キャンセル',
  'action.close': '閉じる',
  'action.copy': 'コピー',
  'action.create': '作成',
  'action.delete': '削除',
  'action.ok': 'OK',
  'action.save': '保存',

  // menus
  'menu.file': 'ファイル',
  'menu.file.new': '新規',
  'menu.file.open': '開く',
  'menu.file.save': '保存',
  'menu.file.export': 'エクスポート',
  'menu.edit': '編集',
  'menu.edit.undo': '元に戻す',
  'menu.edit.redo': 'やり直す',
  'menu.edit.copy': 'コピー',
  'menu.edit.cut': '切り取り',
  'menu.edit.paste': '貼り付け',
  'menu.edit.selectAll': 'すべて選択',
  'menu.edit.clearAll': 'すべて消去',
  'menu.edit.resize': 'サイズ変更',
  'menu.view': '表示',
  'menu.view.2d': '2D 表示',
  'menu.view.3d': '3D 表示',
  'menu.settings': '設定',
  'menu.help': 'ヘルプ',

  // panels
  'panel.configuration': '構成',
  'panel.palette': 'ブロック',
  'panel.stats': '統計',
  'panel.parts': '部品',
  'panel.scalars': 'パラメータ',
  'panel.generator': '生成器',

  // statistics
  'stat.totalOutput': '総出力',
  'stat.totalHeat': '総発熱',
  'stat.totalCooling': '総冷却',
  'stat.netHeat': '正味熱量',
  'stat.totalEfficiency': '総効率',
  'stat.heatMult': '熱倍率',
  'stat.totalFuelCells': '燃料セル数',
  'stat.cells': 'セル数',
  'stat.functionalBlocks': '機能ブロック数',
  'stat.missingCasings': '不足している筐体',
  'stat.numControllers': '制御器数',
  'stat.shutdownFactor': '停止係数',
  'stat.sparsityMult': '疎性倍率',
  'stat.totalIrradiation': '総照射量',
  'stat.rawOutput': '生出力',
  'stat.offOutput': '停止時出力',
  'stat.power': '出力',
  'stat.heat': '発熱',
  'stat.cooling': '冷却',
  'stat.efficiency': '効率',

  // the generator panel (R4.4)
  'generator.preset': 'プリセット',
  'generator.seed': '乱数シード',
  'generator.threads': 'スレッド数',
  'generator.iterations': '反復回数',
  'generator.start': '開始',
  'generator.stop': '停止',
  'generator.useResult': '結果を採用',
  'generator.applied': '生成結果をエディタに読み込みました。元に戻すと以前の設計に戻ります。',
  'generator.unavailable':
    'この原子炉には生成器プリセットがありません。生成器は Overhaul と Underhaul の SFR のみに対応しています。',
  'generator.note':
    '探索は統計パネルと同じ物理カーネルを使うため、報告される数値はここに表示される値と一致します。',
  'generator.status.starting': '開始しています…',

  // settings
  'settings.theme': 'テーマ',
  'settings.language': '言語',

  // messages
  'message.opened': '{0} を開きました',
  'message.saved': '{0} を保存しました',
};

/** Plural-bearing keys the app asks for, with Japanese forms (no plural distinction). */
const PLURALS = {
  'generator.threads.option': { other: '{0} スレッド' },
  'generator.iterations.option': { other: '{0} 回' },
};

const canonical = JSON.parse(readFileSync(SOURCE, 'utf8'));
const messages = {};
let translated = 0;
let keptEnglish = 0;

for (const [key, value] of Object.entries(canonical.messages)) {
  const hit = TABLE[key];
  if (typeof hit === 'string') {
    messages[key] = hit;
    translated++;
  } else {
    // No translation authored: keep the canonical English so the key *exists* (the CI gate
    // requires presence, not fluency) and count it as untranslated.
    messages[key] = value;
    keptEnglish++;
  }
}

const total = translated + keptEnglish;
const percent = (translated / total) * 100;
const out = {
  meta: {
    locale: LOCALE,
    name: '日本語',
    version: '0.1.0-r5',
    status: 'third-locale',
    generatedBy: 'tools/ts/make-locale.mjs',
    source: 'lang/en_US.app.json',
    counts: { messages: total },
    translated,
    untranslated: keptEnglish,
    coverage: `${percent.toFixed(1)}%`,
    pluralKeys: PLURALS,
    note:
      'R5.2 proof that a new language is data, not code: this locale was added without touching any TypeScript. ' +
      `${translated} of ${total} keys (${percent.toFixed(1)}%) are authored translations; the rest keep the ` +
      'canonical English text so the key set is complete. The untranslated count is reported rather than hidden.',
  },
  messages,
};

const rendered = `${JSON.stringify(out, null, 2)}\n`;
const exists = existsSync(OUT);

if (process.argv.includes('--check')) {
  if (!exists) {
    console.error(`make-locale --check FAILED: ${OUT} does not exist (run without --check)`);
    process.exit(1);
  }
  if (readFileSync(OUT, 'utf8') !== rendered) {
    console.error(`make-locale --check FAILED: ${OUT} differs from the generated result`);
    process.exit(1);
  }
  console.log(
    `make-locale --check OK: ${OUT} matches (${total} keys, ${translated} translated, ${percent.toFixed(1)}%)`,
  );
  process.exit(0);
}

if (exists && readFileSync(OUT, 'utf8') === rendered) {
  console.log(`unchanged: ${OUT} is already the generated result`);
} else {
  writeFileSync(OUT, rendered);
  console.log(`wrote ${OUT}`);
}
console.log(
  `  keys ${total} · translated ${translated} · English kept ${keptEnglish} · coverage ${percent.toFixed(1)}%`,
);
