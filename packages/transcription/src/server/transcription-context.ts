import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";

const realtimeEventSchema = Type.Object({ type: Type.String(), session: Type.Optional(Type.Unknown()) }, { additionalProperties: true });
const sessionSchema = Type.Record(Type.String(), Type.Unknown());

/** Read the workspace's pronunciation hints at the start of each dictation session. */
export async function readTranscriptionContext(workspaceRoot: string): Promise<string[]> {
  const path = join(workspaceRoot, ".agents-in-the-cloud", "transcription-context");
  const contents = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  });
  return contents.split(/\r?\n/).map((line) => line.split("#", 1)[0]!.trim()).filter(Boolean);
}

/** Add the workspace's phrase hints to the realtime session before audio starts. */
export function addTranscriptionContext(message: string, phrases: string[]): string {
  if (!phrases.length) return message;
  const event = Value.Parse(realtimeEventSchema, JSON.parse(message));
  if (event.type !== "session.update") return message;
  const session = Value.Parse(sessionSchema, event.session);
  return JSON.stringify({ ...event, session: { ...session, speech_contexts: [{ phrases, boost: 3 }] } });
}
