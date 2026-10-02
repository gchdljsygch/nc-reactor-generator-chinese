/**
 * Opening a project in the app: text/bytes in, `NCPFProjectDocument` out.
 *
 * The app never asks "which format is this?" itself — R2's reader chain
 * (`@ncplanner/formats` `readAnyProjectText`) does, including the legacy formats
 * (LegacyNCPF v10/v11, Hellrage, NCConfig) that the compatibility layer ports.
 * Keeping this in one function is what makes drag-and-drop, the file picker and
 * the tests exercise the *same* path.
 */

import {
  readAnyProjectText,
  type NcpfProjectDocument,
} from '@ncplanner/formats';

export interface OpenedProject {
  readonly document: NcpfProjectDocument;
  /** Which reader won (`NCPFReader`, `LegacyNCPF11Reader`, …). */
  readonly reader: string;
  readonly issues: readonly string[];
}

export function openProjectText(text: string, container: string): OpenedProject {
  const outcome = readAnyProjectText(text, container);
  return { document: outcome.document, reader: outcome.reader, issues: outcome.issues };
}

export function openProjectBytes(bytes: Uint8Array, container: string): OpenedProject {
  const outcome = readAnyProjectText(new TextDecoder('utf-8').decode(bytes), container);
  return { document: outcome.document, reader: outcome.reader, issues: outcome.issues };
}
