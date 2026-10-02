/**
 * `@ncplanner/i18n` — locale management, message lookup and data-name lookup.
 *
 * Design rules that the tests enforce (they come from R0 findings and
 * `docs/rewrite-plan-r1-r5.md` §3.3 / §11.2):
 *
 *  1. missing key → the **whole** string comes from the canonical locale, or the
 *     key itself; never a half translation;
 *  2. i18n keys are stable ids, not English prose, and are never built by
 *     concatenating fragments;
 *  3. data names are looked up by a four-segment language-independent identity;
 *  4. adding a language is one JSON file — no code.
 */

export * from './locale.js';
export * from './format.js';
export * from './pack.js';
export * from './missingKeyReporter.js';
export * from './messageBundle.js';
export * from './dataNameBundle.js';
export * from './localeManager.js';
