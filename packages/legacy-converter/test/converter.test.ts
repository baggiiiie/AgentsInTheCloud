import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type ConversationId, type EntryDraft, UserEntry } from "@earendil-works/pi-durable";
import { convertLegacyAgents, type HistoryImportDestination, type LegacyConversion, type ConvertedAgent } from "../src/index.ts";
import { historyNote } from "../src/entries.ts";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "legacy-converter-package-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function options(destination: () => Promise<HistoryImportDestination>, metadata?: string): LegacyConversion {
  return { workspaceId: "workspace", workspaceDirectory: join(root, "workspace"), shareDirectory: join(root, "share"), metadata, destination };
}

test("standalone converter reads supplied paths and produces native entries without application modules", async () => {
  const record = { conversationId: "old-conversation", label: "Agent 1", title: "Saved work" };
  const directory = join(root, "workspace", "agent-sessions");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${record.conversationId}.jsonl`);
  const source = [
    { type: "session", version: 3, id: "session" },
    { type: "message", id: "user", parentId: null, message: { role: "user", content: "Saved prompt", timestamp: 1 } },
  ].map(row => JSON.stringify(row)).join("\n");
  await writeFile(path, source);
  let imported: { identity: { agentId: string; label: string; title: string }; entries: readonly EntryDraft[] } | undefined;
  const destination: HistoryImportDestination = {
    async catalog() { return imported ? [imported.identity] : []; },
    async importHistory(identity, entries) {
      imported = { identity, entries };
      // SAFETY: Test-only storage-local identity; no engine operations consume it.
      return 1 as ConversationId;
    },
  };
  const input = options(async () => destination, JSON.stringify({ conversations: [record] }));
  expect(await convertLegacyAgents(input)).toEqual([{ agentId: record.conversationId, label: record.label, title: record.title, storage: "durable" }]);
  expect(imported!.entries.map(entry => entry.kind)).toEqual([historyNote.kind, UserEntry.kind]);
  expect(imported!.entries[1]!.model).toEqual([{ role: "user", content: "Saved prompt", timestamp: 1 }]);
  expect(await readFile(path, "utf8")).toBe(source);
  // The host has committed the identity but not its new metadata. No source read
  // or duplicate import is needed to finish that interrupted cutover.
  await rm(path);
  const first = imported;
  expect(await convertLegacyAgents(input)).toEqual([{ agentId: record.conversationId, label: record.label, title: record.title, storage: "durable" }]);
  expect(imported).toBe(first);
});

test("native-only metadata and empty discovery do not open a destination", async () => {
  const destination = async (): Promise<HistoryImportDestination> => { throw new Error("must not open a journal"); };
  const record: ConvertedAgent = { agentId: "native", label: "Agent 1", title: "Native", storage: "durable" };
  expect(await convertLegacyAgents(options(destination, JSON.stringify({ conversations: [{ conversationId: record.agentId, label: record.label, title: record.title, storage: record.storage }] })))).toEqual([record]);
  expect(await convertLegacyAgents(options(destination))).toEqual([]);
});
