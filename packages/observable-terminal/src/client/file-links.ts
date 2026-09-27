import type { RenderRow } from "@gespenst/core";

export interface TerminalFileLink { path: string; line?: number; column?: number }

function positive(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/** Only an explicit OSC 8 file destination conveys link intent. Never navigate to arbitrary terminal URLs. */
export function terminalFileUri(uri: string): TerminalFileLink | undefined {
  let url: URL;
  try { url = new URL(uri); } catch { return undefined; }
  if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) return undefined;
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return undefined; }
  if (!path.startsWith("/") || path.includes("\0")) return undefined;
  const fragment = url.hash.match(/^#L(\d+)(?:C(\d+))?$/i);
  return { path, line: positive(url.searchParams.get("line")) ?? positive(fragment?.[1]), column: positive(url.searchParams.get("column")) ?? positive(fragment?.[2]) };
}

// File-shaped tokens only; OSC 8 is the unambiguous case. The open endpoint
// verifies that a plain-text candidate actually names a file.
const reference = /(?:^|[\s([`'"=])((?:\/|\.\.?\/)?(?:[^\s<>:"'`()[\]{},;!?/]+\/)*[^\s<>:"'`()[\]{},;!?/]+\.[a-zA-Z][\w+-]*)(?::(\d+)(?::(\d+))?)?(?=$|[\s.)\]}'"`,;!?])/g;

export function terminalTextFileAt(text: string, offset: number): TerminalFileLink | undefined {
  for (const match of text.matchAll(reference)) {
    const path = match[1]!;
    const start = match.index + match[0].indexOf(path);
    const end = start + path.length + (match[2] ? match[2].length + 1 : 0) + (match[3] ? match[3].length + 1 : 0);
    if (offset < start || offset >= end) continue;
    return { path, line: positive(match[2]), column: positive(match[3]) };
  }
  return undefined;
}

/** Resolve a screen cell to its OSC 8 destination, or a conservative visible path. */
export function terminalFileAt(row: RenderRow, column: number): TerminalFileLink | undefined {
  // Compute the string offset and inspect OSC 8 metadata in one pass. Cell
  // columns and JavaScript string offsets diverge for wide or Unicode text.
  let offset = 0;
  let nextColumn = 0;
  let uri: string | null | undefined;
  for (const cell of row.cells) {
    if (cell.x >= column) {
      if (cell.x === column) uri = cell.hyperlinkUri ?? uri;
      break;
    }
    offset += cell.x - nextColumn;
    if (cell.width !== "spacer-tail") offset += cell.text.length;
    nextColumn = cell.x + 1;
    if (cell.width === "wide" && cell.x + 1 === column) uri = cell.hyperlinkUri;
  }
  if (uri) return terminalFileUri(uri);
  return terminalTextFileAt(row.text, offset + Math.max(0, column - nextColumn));
}
