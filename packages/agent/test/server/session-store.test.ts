import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  archiveWorkspaceAgentConversation,
  createNextWorkspaceAgentConversation,
  ensureDefaultWorkspaceAgentConversation as ensureNativeConversation,
  listWorkspaceAgentConversations,
  setWorkspaceAgentConversationTitle,
  sessionShareDir,
  sessionShareKeySlug,
} from "../../src/server/session-store.ts";

let dir: string | undefined;

async function dataDir(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "atelier-agent-test-"));
  process.env.ATELIER_DATA_DIR = dir;
  return dir;
}

const ensureDefaultWorkspaceAgentConversation = ensureNativeConversation;

async function writeProjectInit(workspaceId: string, projectId: string, sessionShareKey: string): Promise<void> {
  const path = join(process.env.ATELIER_DATA_DIR!, "workspaces", workspaceId, "metadata");
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "init.json"), JSON.stringify({ type: "project.git", projectId, name: "repo", gitUrl: "https://example.com/repo.git", branch: null, sessionShareKey }));
}

afterEach(async () => {
  delete process.env.ATELIER_DATA_DIR;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("Workspace Agent conversation store", () => {
  test("project and projectless journals resolve through workspace metadata", async () => {
    const root = await dataDir();
    await writeProjectInit("front", "frontend", "suite");
    const front = await ensureNativeConversation("front");
    expect(front.path).toBe(join(root, "session-shares", "suite", "builtin-durable", "front"));
    const scratch = await ensureNativeConversation("scratch");
    expect(scratch.path).toBe(join(root, "session-shares", "projectless", "builtin-durable", "scratch"));
  });

  test("concurrent Agent creation assigns unique ordered labels", async () => {
    await dataDir();

    const [defaultA, defaultB] = await Promise.all([
      ensureNativeConversation("ws1"),
      ensureNativeConversation("ws1"),
    ]);
    const created = await Promise.all(Array.from({ length: 4 }, () => createNextWorkspaceAgentConversation("ws1")));

    expect(defaultA.conversationId).toBe(defaultB.conversationId);
    expect(created.map((agent) => agent.label)).toEqual(["Agent 2", "Agent 3", "Agent 4", "Agent 5"]);
    expect(new Set(created.map((agent) => agent.conversationId)).size).toBe(4);
    expect((await listWorkspaceAgentConversations("ws1")).map((agent) => agent.label)).toEqual(["Agent 1", "Agent 2", "Agent 3", "Agent 4", "Agent 5"]);
  });

  test("concurrent list readers observe a newly published conversation with its title", async () => {
    await dataDir();

    const creation = ensureNativeConversation("ws1");
    const readers = Array.from({ length: 8 }, () => listWorkspaceAgentConversations("ws1"));
    const [created, ...snapshots] = await Promise.all([creation, ...readers]);

    for (const snapshot of snapshots) expect(snapshot).toEqual([created]);
  });

  test("Agent conversations have immutable identities and mutable titles", async () => {
    await dataDir();
    const created = await ensureDefaultWorkspaceAgentConversation("ws1");
    expect(created.title).toBe("Untitled");

    const renamed = await setWorkspaceAgentConversationTitle(created, "Investigate persistence");

    expect(renamed).toMatchObject({ conversationId: created.conversationId, title: "Investigate persistence" });
    expect(await listWorkspaceAgentConversations("ws1")).toEqual([renamed]);
  });

  test("archiving metadata does not resurrect the tab and permits label reuse", async () => {
    await dataDir();
    const first = await ensureNativeConversation("ws1");
    const second = await createNextWorkspaceAgentConversation("ws1");
    await archiveWorkspaceAgentConversation(second);
    expect(await listWorkspaceAgentConversations("ws1")).toEqual([first]);
    expect((await createNextWorkspaceAgentConversation("ws1")).label).toBe("Agent 2");
  });

  test("slugs are filesystem friendly", () => {
    expect(sessionShareKeySlug("Product Suite")).toBe("product-suite");
    expect(sessionShareDir("Product Suite", "/tmp/data")).toBe("/tmp/data/session-shares/product-suite");
  });
});

test("new conversations explicitly select durable storage without a legacy transcript", async () => {
  const root = await dataDir();
  const agent = await ensureNativeConversation("native");
  expect(agent.storage).toBe("durable");
  expect(agent.path).toBe(join(root, "session-shares", "projectless", "builtin-durable", "native"));
  expect(await Bun.file(join(root, "workspaces", "native", "agent-sessions", `${agent.conversationId}.jsonl`)).exists()).toBe(false);
  const renamed = await setWorkspaceAgentConversationTitle(agent, "Before first turn");
  expect(renamed.storage).toBe("durable");
  await archiveWorkspaceAgentConversation(renamed);
  expect(await listWorkspaceAgentConversations("native")).toEqual([]);
});
