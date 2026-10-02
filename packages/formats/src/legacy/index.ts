/**
 * R2 — the legacy reader registry.
 *
 * Importing this module registers every ported historical reader with
 * `./detect.js`, so `readAnyProjectText` / `readAnyProjectBytes` accept NCPF
 * JSON, LegacyNCPF v10/v11, the Hellrage JSON dialects and the NCConfig `.cfg`
 * files. The `order` of each reader mirrors the position of the same reader in
 * the frozen version's registration list
 * (`tools/golden/src/net/ncplanner/plannerator/tools/Bootstrap.java:89-117`),
 * which is what decides who wins when two readers both claim a file.
 *
 * Side-effecting import: `packages/formats/src/index.ts` is the only place that
 * needs to import it, and it does.
 */
import { registerLegacyReader, registeredReaders } from './detect.js';
import { LegacyNCPF11Reader } from './ncpf11.js';
import { LegacyNCPF10Reader } from './ncpf10.js';
import { LegacyNCPF9Reader } from './ncpf09.js';
import { LegacyNCPF8Reader } from './ncpf08.js';
import { LegacyNCPF7Reader } from './ncpf07.js';
import { LegacyNCPF6Reader } from './ncpf06.js';
import { LegacyNCPF5Reader } from './ncpf05.js';
import { LegacyNCPF4Reader } from './ncpf04.js';
import { LegacyNCPF3Reader } from './ncpf03.js';
import { LegacyNCPF2Reader } from './ncpf02.js';
import { LegacyNCPF1Reader } from './ncpf01.js';
import { hellrageReaders } from './hellrage.js';
import { NC_CONFIG_READERS } from './ncconfig.js';
import type { LegacyFormatReader } from './types.js';

/** Every reader this build knows about, in the order the chain tries them. */
export function allLegacyReaders(): readonly LegacyFormatReader[] {
  return [
    new LegacyNCPF11Reader(),
    new LegacyNCPF10Reader(),
    new LegacyNCPF9Reader(),
    new LegacyNCPF8Reader(),
    new LegacyNCPF7Reader(),
    new LegacyNCPF6Reader(),
    new LegacyNCPF5Reader(),
    new LegacyNCPF4Reader(),
    new LegacyNCPF3Reader(),
    new LegacyNCPF2Reader(),
    new LegacyNCPF1Reader(),
    ...hellrageReaders(),
    ...NC_CONFIG_READERS,
  ];
}

let registered = false;

/** Idempotent: registers every ported reader once. */
export function registerAllLegacyReaders(): readonly LegacyFormatReader[] {
  if (!registered) {
    for (const reader of allLegacyReaders()) registerLegacyReader(reader);
    registered = true;
  }
  return registeredReaders();
}

registerAllLegacyReaders();

export { readAnyProjectBytes, readAnyProjectBytesSync, readAnyProjectText, registeredReaders } from './detect.js';
export { LegacyNCPF11Reader } from './ncpf11.js';
export { LegacyNCPF10Reader } from './ncpf10.js';
export { LegacyNCPF9Reader } from './ncpf09.js';
export { LegacyNCPF8Reader } from './ncpf08.js';
export { LegacyNCPF7Reader } from './ncpf07.js';
export { LegacyNCPF6Reader } from './ncpf06.js';
export { LegacyNCPF5Reader } from './ncpf05.js';
export { LegacyNCPF4Reader } from './ncpf04.js';
export { LegacyNCPF3Reader } from './ncpf03.js';
export { LegacyNCPF2Reader } from './ncpf02.js';
export { LegacyNCPF1Reader } from './ncpf01.js';
export { hellrageReaders } from './hellrage.js';
export { NC_CONFIG_READERS, OverhaulNCConfigReader, UnderhaulNCConfigReader } from './ncconfig.js';
