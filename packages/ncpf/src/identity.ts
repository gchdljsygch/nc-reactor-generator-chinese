import type { NCPFElement } from './element.js';

/**
 * Element identity keys.
 *
 * R0 finding #4: `type|definition` alone is **not** unique — 29 keys mapped onto
 * conflicting display names (mostly fuel items and the blockstate variants of
 * coolers/reflectors) until the configuration and the configuration type were
 * added. The identity key is therefore four segments:
 *
 *     <config>/<cfgType>/<type>|<definition>
 *
 * The two namespaces are the ones R0's `ElementDump` used and the ones the
 * translation packs are keyed by:
 *
 *  - `<config>`  = the configuration's own name, i.e. Java
 *    `Configuration.getName()` — `NuclearCraft` for the shipped file. (For a
 *    loaded project that is `Configuration.metadata.name`, not the file name.)
 *  - `<cfgType>` = the configuration *type* — `Overhaul SFR Configuration` in
 *    ElementDump, i.e. the reactor type's configuration class. The TS loader
 *    carries the equivalent as the configuration id
 *    (`nuclearcraft:overhaul_sfr`); both discriminate identically, and the id is
 *    the more stable of the two. Whatever a caller passes, it must pass the
 *    *same* value everywhere so the keys join.
 *
 * Example (matching `datasets/ncpf-elements.jsonl`):
 *
 *     NuclearCraft/Overhaul SFR Configuration/legacy_block|nuclearcraft:solid_fission_sink:0[type=water]
 *
 * These keys are the join point between the configuration data, the translation
 * files (`elements` section) and the localization layer. They are stable across
 * languages and across releases as long as the definition does not change.
 */
export function elementIdentityKey(
  configName: string,
  cfgType: string,
  element: NCPFElement,
): string {
  return `${configName}/${cfgType}/${element.definition.type}|${element.definition.identity}`;
}

/** Alias kept for call sites that already hold the definition string. */
export function identityKey(
  configName: string,
  cfgType: string,
  type: string,
  definition: string,
): string {
  return `${configName}/${cfgType}/${type}|${definition}`;
}
