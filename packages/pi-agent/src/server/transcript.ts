import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAtelierRuntimeContext } from "@atelier/core";
import { recordsFromSessionEntries, type TranscriptRecord } from "@atelier/agent/server";
import { nativeImageResponse, nativeImageTypes, nativeJsonlFiles, nativeJsonlRows } from "@atelier/cli-agent/server";
import { Type } from "typebox";
import { Value } from "typebox/value";

const rowSchema = Type.Object({
  type: Type.String(), id: Type.String(), parentId: Type.Union([Type.String(), Type.Null()]), timestamp: Type.String(),
  message: Type.Optional(Type.Object({ role: Type.String(), content: Type.Optional(Type.Union([Type.String(), Type.Array(Type.Object({ type: Type.String() }))])) })),
});
const imageSchema = Type.Object({ type: Type.Literal("image"), mimeType: Type.String(), data: Type.String() });

/** Pi sessions are trees. Show only the current leaf's ancestry, never abandoned branches. */
export function piTranscriptRecords(jsonl: string): TranscriptRecord[] {
  const entries = Array.from(nativeJsonlRows(jsonl, rowSchema));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const lineage = new Set<string>();
  let current = entries.at(-1);
  while (current && !lineage.has(current.id)) {
    lineage.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return recordsFromSessionEntries(entries.filter((entry) => lineage.has(entry.id))).map((record) => record.kind === "user" || record.kind === "toolResult"
    ? { ...record, images: record.images.filter((image) => image.mimeType && nativeImageTypes.has(image.mimeType)) }
    : record);
}

function sessionDirectory(workspaceId: string, sessionId: string): string {
  return join(getAtelierRuntimeContext().atelierDataDir, "workspaces", workspaceId, "home-local", ".local", "share", "pi", "sessions", sessionId);
}
async function sessionFiles(workspaceId: string, sessionId: string): Promise<string[]> {
  return (await nativeJsonlFiles(sessionDirectory(workspaceId, sessionId))).sort();
}
export async function loadPiTranscript(workspaceId: string, sessionId: string): Promise<TranscriptRecord[] | undefined> {
  const files = await sessionFiles(workspaceId, sessionId);
  if (!files.length) return undefined;
  return (await Promise.all(files.map(async (file) => piTranscriptRecords(await readFile(file, "utf8"))))).flat();
}
export async function loadPiTranscriptImage(workspaceId: string, sessionId: string, entryId: string, contentIndex: number): Promise<Response> {
  for (const file of await sessionFiles(workspaceId, sessionId)) {
    for (const entry of nativeJsonlRows(await readFile(file, "utf8"), rowSchema)) {
      if (entry.id !== entryId || entry.type !== "message" || !Array.isArray(entry.message?.content)) continue;
      const image = entry.message.content[contentIndex];
      if (Value.Check(imageSchema, image) && nativeImageTypes.has(image.mimeType)) return nativeImageResponse(image.data, image.mimeType);
    }
  }
  return new Response("Not found", { status: 404 });
}
