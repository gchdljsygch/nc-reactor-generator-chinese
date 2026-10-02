import { readFileSync } from 'node:fs';
import { configurationSpec } from '../src/configSpecs.js';
import { isJsonObject } from '../src/json.js';
import { javaExpandedElements } from '../src/fingerprint.js';
import { readNcpfProject, type NcpfProjectDocument } from '../src/project.js';

/**
 * Shared test helpers for R1.4.
 *
 * The production corpus is 18.7 MB of JSON across 38 files, so every test reads
 * through this cache instead of re-parsing.
 */
const cache = new Map<string, NcpfProjectDocument>();

export function project(path: string): NcpfProjectDocument {
  let document = cache.get(path);
  if (document === undefined) {
    document = readNcpfProject(path);
    cache.set(path, document);
  }
  return document;
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Java `RoundTrip.countElements`: main configurations plus addons, over the
 * `getAllElementsISaidAllElements()` expansion.
 */
export function countElements(document: NcpfProjectDocument, includeAddons = true): number {
  let total = 0;
  for (const configuration of document.configurations) {
    total += javaExpandedElements(configuration.raw, configurationSpec(configuration.id)).length;
  }
  if (includeAddons) {
    for (const addon of document.addons) {
      for (const configuration of addon.configurations) {
        total += javaExpandedElements(configuration.raw, configurationSpec(configuration.id)).length;
      }
    }
  }
  return total;
}

/**
 * Java `RoundTrip.countDisplayNames`: elements of the *main* configurations whose
 * `plannerator:display_name` module carries a name.
 */
export function countDisplayNames(document: NcpfProjectDocument): number {
  let total = 0;
  for (const configuration of document.configurations) {
    for (const element of javaExpandedElements(configuration.raw, configurationSpec(configuration.id))) {
      const modules = isJsonObject(element.modules) ? element.modules : undefined;
      const display = modules?.['plannerator:display_name'];
      if (isJsonObject(display) && typeof display.display_name === 'string') total++;
    }
  }
  return total;
}

/** Every `modules` bag key in a JSON tree (used to assert what the export keeps). */
export function moduleKeys(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const value of node) moduleKeys(value, found);
    return found;
  }
  if (!isJsonObject(node)) return found;
  const modules = node.modules;
  if (isJsonObject(modules)) found.push(...Object.keys(modules));
  for (const value of Object.values(node)) moduleKeys(value, found);
  return found;
}

/** Deep JSON equality helper with a readable path on mismatch (vitest handles it). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
