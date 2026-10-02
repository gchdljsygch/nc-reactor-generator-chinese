/**
 * Data-name localisation (R1.2c).
 *
 * Data names (blocks, fuels, recipes, fluids — everything that comes from an
 * `.ncpf.json` configuration) are localised through a **separate** table from UI
 * messages, keyed by a language-independent identity instead of English prose:
 *
 *     <config>/<cfgType>/<type>|<definition>
 *
 * Why four segments: R0 finding #4. With a bare `type|definition`, 660 distinct
 * keys mapped onto 29 *conflicting* display names — the same `legacy_item`
 * (`nuclearcraft:fuel_americium:2`) is `HEA-242` in the Underhaul SFR
 * configuration and `LEA-242 Nitride` in the Overhaul SFR one. Adding the
 * configuration name and the configuration type removes every conflict
 * (`packages/i18n/test/dataNames.test.ts` asserts this over all 948 elements).
 *
 * The segments are the ones `tools/golden/.../ElementDump.java` writes and the
 * ones `lang/zh_CN.elements.json` is keyed by:
 *
 *  - `config` — `Configuration.getName()` (`plannerator:configuration_metadata.name`,
 *    e.g. `NuclearCraft`),
 *  - `cfgType` — the configuration *type* name (e.g. `Overhaul SFR Configuration`).
 *
 * Note: `@ncplanner/ncpf`'s `elementIdentityKey(container, configId, element)`
 * formats exactly this string; its parameter names describe the other naming
 * (`container` = file name, `configId` = `nuclearcraft:overhaul_sfr`) used by
 * `Configuration`. The concatenation is identical, and this module reuses the
 * helper rather than re-implementing the format.
 *
 * Lookup/fallback policy: a localised name is a whole string. If the element is
 * absent from every level of the chain the caller gets the English canonical name
 * (`NCPFElement.canonicalName`) — never a partly translated name.
 */

import { elementIdentityKey, identityKey, type NCPFElement } from '@ncplanner/ncpf';
import type { LocaleSource } from './pack.js';
import type { MissingKeyReporter } from './missingKeyReporter.js';

/** Four-segment identity key for an element, reused from `@ncplanner/ncpf`. */
export function dataNameKey(config: string, cfgType: string, element: NCPFElement): string {
  return elementIdentityKey(config, cfgType, element);
}

/** Same key, for callers that only hold the definition's `type`/`toString()`. */
export function dataNameKeyFor(
  config: string,
  cfgType: string,
  type: string,
  definition: string,
): string {
  return identityKey(config, cfgType, type, definition);
}

export interface DataNameBundleOptions {
  reporter?: MissingKeyReporter;
}

export class DataNameBundle {
  private readonly source: LocaleSource;
  private readonly reporter: MissingKeyReporter | undefined;

  constructor(source: LocaleSource, options: DataNameBundleOptions = {}) {
    this.source = source;
    this.reporter = options.reporter;
  }

  /** First level of the chain that has a translation for `key`. */
  lookupByKey(key: string): string | undefined {
    for (const locale of this.source.chain()) {
      const value = this.source.pack(locale)?.elements[key];
      if (value !== undefined) return value;
    }
    return undefined;
  }

  /** Convenience: build the identity key and look it up. */
  lookupElement(config: string, cfgType: string, element: NCPFElement): string | undefined {
    return this.lookupByKey(dataNameKey(config, cfgType, element));
  }

  /**
   * The name to display, falling back **whole** to the element's English
   * canonical name. Logic and file IO must keep using `canonicalName`; this
   * method exists for display only.
   */
  name(config: string, cfgType: string, element: NCPFElement): string {
    return this.nameOr(dataNameKey(config, cfgType, element), element.canonicalName);
  }

  /** Lookup with an explicit fallback string (e.g. a definition with no element). */
  nameOr(key: string, canonicalName: string): string {
    for (const locale of this.source.chain()) {
      const value = this.source.pack(locale)?.elements[key];
      if (value === undefined) continue;
      if (locale !== this.source.locale) {
        this.reporter?.report({
          key,
          kind: 'element',
          locale: this.source.locale,
          resolvedLocale: locale,
          fallback: locale === this.source.canonical ? 'canonical' : 'language',
        });
      }
      return value;
    }
    this.reporter?.report({
      key,
      kind: 'element',
      locale: this.source.locale,
      fallback: 'canonical-name',
    });
    return canonicalName;
  }
}
