/**
 * `@ncplanner/kernel` — the single physics kernel.
 *
 * Iron law: **the editor and the generator call the same physics**. There is one
 * implementation; `simulate()` is the entry point today, and R4 will add a
 * `simulateFast()` / `simulateVerbose()` pair over this same code rather than a
 * second engine.
 */
export * from './float.js';
export * from './geometry.js';
export * from './rules.js';
export * from './fast.js';
export * from './sfr/config.js';
export * from './sfr/reactor.js';
export * from './usfr/config.js';
export * from './usfr/reactor.js';
export * from './msr/config.js';
export * from './msr/reactor.js';
export * from './turbine/config.js';
export * from './turbine/reactor.js';
export * from './dataset.js';
export * from './stats.js';
