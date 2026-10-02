// ---------------------------------------------------------------------------
// `Mutator.importFrom` — translating a stored index list between configurations
// ---------------------------------------------------------------------------

import type { Configuration, NCPFElement } from '@ncplanner/ncpf';
import type { SfrTemplate, UsfrTemplate } from '@ncplanner/kernel';
import type { CompiledEntry, CompiledSfrConfiguration, CompiledUsfrConfiguration } from './compiled.js';

/** The subset of an NCPF block the import rule reads. */
type NCPFElementView = NCPFElement;

/**
 * The NCPF module ids the import comparison looks at. Hard-coded on purpose: they
 * are wire-format identifiers (the same strings `packages/kernel` reads), and the
 * import rule is defined in terms of them.
 */
const MODULE = {
  sfrConductor: 'nuclearcraft:overhaul_sfr:conductor',
  sfrFuelCell: 'nuclearcraft:overhaul_sfr:fuel_cell',
  sfrIrradiator: 'nuclearcraft:overhaul_sfr:irradiator',
  sfrReflector: 'nuclearcraft:overhaul_sfr:reflector',
  sfrModerator: 'nuclearcraft:overhaul_sfr:moderator',
  sfrShield: 'nuclearcraft:overhaul_sfr:neutron_shield',
  sfrHeatsink: 'nuclearcraft:overhaul_sfr:heat_sink',
  usfrFuelCell: 'nuclearcraft:underhaul_sfr:fuel_cell',
  usfrModerator: 'nuclearcraft:underhaul_sfr:moderator',
  usfrCooler: 'nuclearcraft:underhaul_sfr:cooler',
  usfrActiveCooler: 'nuclearcraft:underhaul_sfr:active_cooler',
} as const;

/**
 * Why this exists: **the four shipped presets ship their own stripped
 * configuration**, and their stored `indicies` are indices into *that* list — six
 * placeholder blocks named `FUEL CELL`, `IRRADIATOR`, `REFLECTOR`, `MODERATOR`,
 * `SHIELD`, `HEATSINK`, each carrying only its function module and zeroed stats.
 * Loaded against the real NuclearCraft configuration those indices mean nothing
 * until they are re-expressed as "every real block with these function modules".
 *
 * Java `Mutator.importFrom(multiblock, ncpf.configuration)` does exactly that, and
 * the comparison is asymmetric in a way that matters:
 *
 *  - the **stored** side is read from `configuration.blocks[i - 1]` — the raw NCPF
 *    block list, where a heatsink counts as "has the `heat_sink` module";
 *  - the **target** side is read from the compiled entry arrays, where a heatsink
 *    counts as "`blockCooling != 0`".
 *
 * So a preset whose placeholder heatsink has `cooling: 0` still matches the real
 * heatsinks (which have `cooling != 0`), which is the only reason the shipped
 * presets work at all. Reading both sides the same way would silently drop
 * heatsinks from `indicies` and stall the search. The rule is reproduced verbatim
 * below, including the omitted `neutronSource`/`losTest`/recipe fields.
 *
 * Known asymmetry we do **not** paper over: Java *writes* `indicies` in the
 * compiled-entry space of whatever configuration produced them, then *reads* them
 * back as raw-block indices. For the shipped presets the two spaces coincide (each
 * placeholder block yields exactly one compiled entry: one fuel, one irradiator
 * recipe, none for the rest), so the round trip is lossless. Where they do not
 * coincide the frozen Java already mis-reads its own files; we reproduce that
 * rather than invent a private format.
 */

interface SfrSourceFlags {
  conductor: boolean;
  fuelCell: boolean;
  irradiator: boolean;
  reflector: boolean;
  moderator: boolean;
  shield: boolean;
  heatsink: boolean;
}

interface SfrTargetFlags {
  conductor: boolean;
  fuelCell: boolean;
  irradiator: boolean;
  reflector: boolean;
  moderator: boolean;
  shield: boolean;
  heatsinkCooling: number;
}

interface UsfrSourceFlags {
  fuelCell: boolean;
  moderator: boolean;
  cooler: boolean;
  activeCooler: boolean;
}

interface UsfrTargetFlags {
  fuelCell: boolean;
  moderator: boolean;
  coolerCooling: number;
  activeCooler: boolean;
}

function hasModule(element: NCPFElementView, moduleName: string): boolean {
  return element.modules[moduleName] !== undefined;
}

function sfrSourceFlags(element: NCPFElementView): SfrSourceFlags {
  return {
    conductor: hasModule(element, MODULE.sfrConductor),
    fuelCell: hasModule(element, MODULE.sfrFuelCell),
    irradiator: hasModule(element, MODULE.sfrIrradiator),
    reflector: hasModule(element, MODULE.sfrReflector),
    moderator: hasModule(element, MODULE.sfrModerator),
    shield: hasModule(element, MODULE.sfrShield),
    heatsink: hasModule(element, MODULE.sfrHeatsink),
  };
}

function usfrSourceFlags(element: NCPFElementView): UsfrSourceFlags {
  return {
    fuelCell: hasModule(element, MODULE.usfrFuelCell),
    moderator: hasModule(element, MODULE.usfrModerator),
    cooler: hasModule(element, MODULE.usfrCooler),
    activeCooler: hasModule(element, MODULE.usfrActiveCooler),
  };
}

function sfrTargetFlags(entry: CompiledEntry<SfrTemplate>): SfrTargetFlags {
  const t = entry.template;
  return {
    conductor: t.conductor,
    fuelCell: t.fuelCell,
    irradiator: t.irradiator,
    reflector: t.reflector !== null,
    moderator: t.moderator !== null,
    shield: t.neutronShield !== null,
    heatsinkCooling: t.heatsink?.cooling ?? 0,
  };
}

function usfrTargetFlags(entry: CompiledEntry<UsfrTemplate>): UsfrTargetFlags {
  const t = entry.template;
  return {
    fuelCell: t.fuelCell,
    moderator: t.moderator,
    coolerCooling: t.cooler?.cooling ?? 0,
    activeCooler: t.activeCooler,
  };
}

function sfrMatches(source: SfrSourceFlags, target: SfrTargetFlags): boolean {
  return (
    source.heatsink === (target.heatsinkCooling !== 0) &&
    source.fuelCell === target.fuelCell &&
    source.moderator === target.moderator &&
    source.irradiator === target.irradiator &&
    source.reflector === target.reflector &&
    source.shield === target.shield &&
    source.conductor === target.conductor
  );
}

function usfrMatches(source: UsfrSourceFlags, target: UsfrTargetFlags): boolean {
  return (
    source.cooler === (target.coolerCooling !== 0) &&
    source.fuelCell === target.fuelCell &&
    source.moderator === target.moderator &&
    source.activeCooler === target.activeCooler
  );
}

/**
 * Java `RandomBlockMutator.importFrom` / `RandomCellMutator.importFrom`, Overhaul.
 *
 * `stored` is the index list as read from the file; `source` is the configuration
 * that list was written against; `compiled` is the configuration it must mean now.
 */
export function importSfrIndices(
  stored: readonly number[],
  source: Configuration,
  compiled: CompiledSfrConfiguration,
): number[] {
  let hasAir = false;
  const wanted: SfrSourceFlags[] = [];
  for (const i of stored) {
    if (i === 0) {
      hasAir = true;
      continue;
    }
    const element = source.blocks[i - 1];
    if (element === undefined) continue;
    wanted.push(sfrSourceFlags(element));
  }
  const out: number[] = [];
  if (hasAir) out.push(0);
  for (const entry of compiled.entries) {
    const flags = sfrTargetFlags(entry);
    if (wanted.some((w) => sfrMatches(w, flags))) out.push(entry.index);
  }
  return out;
}

/** Java `RandomBlockMutator.importFrom`, Underhaul. */
export function importUsfrIndices(
  stored: readonly number[],
  source: Configuration,
  compiled: CompiledUsfrConfiguration,
): number[] {
  let hasAir = false;
  const wanted: UsfrSourceFlags[] = [];
  for (const i of stored) {
    if (i === 0) {
      hasAir = true;
      continue;
    }
    const element = source.blocks[i - 1];
    if (element === undefined) continue;
    wanted.push(usfrSourceFlags(element));
  }
  const out: number[] = [];
  if (hasAir) out.push(0);
  for (const entry of compiled.entries) {
    const flags = usfrTargetFlags(entry);
    if (wanted.some((w) => usfrMatches(w, flags))) out.push(entry.index);
  }
  return out;
}
