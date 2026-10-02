/**
 * `@ncplanner/formats` — the NCPF read/write layer (R1.4).
 *
 * Two writers, two semantics (R0 finding #10, `docs/r0/format-roundtrip.md`):
 *  - {@link writeNcpfSave} — `NCPFFileWriter`: full fidelity, nothing trimmed;
 *  - {@link writeNcpfExport} — `NCPFWriter`: `makePartial()` + `plannerator:*`
 *    stripped.
 * Never mix them (iron law 5 in `docs/rewrite-plan-r1-r5.md` §11.2).
 *
 * The acceptance baseline is the R0 fingerprint over the 38 shipped
 * configurations (`fingerprint()`); see `docs/r1/r1.4-ncpf-io.md`.
 *
 * R2 adds the compatibility layer (`./legacy/*`) and the `config2` container
 * (`./config2.js`); the read entry point for "any file the app may be handed" is
 * `readAnyProject()` once the legacy readers are registered.
 */
export * from './json.js';
export * from './config2.js';
export * from './configSpecs.js';
export * from './legacy/types.js';
export * from './legacy/detect.js';
// Side-effecting: registers every ported legacy reader with the detect chain.
export * from './legacy/index.js';
export * from './designs.js';
export * from './fingerprint.js';
export * from './javaModel.js';
export * from './project.js';
export * from './write.js';
