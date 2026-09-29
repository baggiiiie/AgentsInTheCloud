import { readFile } from "node:fs/promises";
import type { TSchema, Static } from "typebox";
import { Value } from "typebox/value";

/** Native CLI histories are append-only; the last line can still be in flight. */
export function* nativeJsonlRows<T extends TSchema>(jsonl: string, schema: T): Generator<Static<T>> {
  const lines = jsonl.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); }
    catch (error) {
      if (index === lines.length - 1) break;
      throw error;
    }
    if (Value.Check(schema, parsed)) {
      // SAFETY: Value.Check validated the parsed row against the supplied schema.
      yield parsed as Static<T>;
    }
  }
}

export async function nativeJsonlText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

export const nativeImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export function nativeImageResponse(data: string, mimeType: string): Response {
  const bytes = Buffer.from(data, "base64");
  return new Response(bytes, { headers: { "Content-Type": mimeType, "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox", "X-Content-Type-Options": "nosniff" } });
}
