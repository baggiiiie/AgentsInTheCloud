import { isProjectOnboardingWorkspace, markProjectOnboardingWorkspace } from "../../src/server/workspace-capabilities.ts";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  archiveWorkspaceAgentConversation,
  createNextWorkspaceAgentConversation,
  ensureDefaultWorkspaceAgentConversation,
  listWorkspaceAgentConversations,
  parseWorkspaceAgentFilename,
  replaceWorkspaceAgentSession,
  publishWorkspaceAgentHistory,
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
  test("parses and ignores filenames", () => {
    expect(parseWorkspaceAgentFilename("Agent 1.jsonl")).toBeUndefined();
    expect(parseWorkspaceAgentFilename("fix-auth-flow--ws1--agent-2--a1b2c3.jsonl", "ws1")).toBeUndefined();
    expect(parseWorkspaceAgentFilename("builtin--fix-auth-flow--ws1--agent-2--53fc77b7-dc19-42d5-b200-2e134ec67529.jsonl", "ws1")).toEqual({
      conversationId: "53fc77b7-dc19-42d5-b200-2e134ec67529",
      label: "Agent 2",
      number: 2,
    });
    expect(parseWorkspaceAgentFilename("builtin--fix-auth-flow--ws1--agent-2--53fc77b7-dc19-42d5-b200-2e134ec67529.jsonl", "ws2")).toBeUndefined();
    expect(parseWorkspaceAgentFilename("fix-auth-flow--ws1--agent-2--53fc77b7-dc19-42d5-b200-2e134ec67529.jsonl", "ws1")?.label).toBe("Agent 2");
  });

  test("unnamed conversations remain workspace-local; named conversations publish without sidecars", async () => {
    const root = await dataDir();
    const agent = await ensureDefaultWorkspaceAgentConversation("ws1");
    expect(agent.path).toStartWith(join(root, "workspaces", "ws1", "agent-sessions"));
    expect(await Bun.file(agent.path).exists()).toBe(true);
    expect(await Bun.file(join(root, "session-shares", "projectless", "builtin--scratch-bug-hunt--ws1--agent-1--" + agent.conversationId + ".jsonl")).exists()).toBe(false);
    await writeFile(agent.path, '{"type":"message"}\n');
    const named = await setWorkspaceAgentConversationTitle(agent, "Scratch bug hunt");
    const published = join(root, "session-shares", "projectless", "builtin--scratch-bug-hunt--ws1--agent-1--" + agent.conversationId + ".jsonl");
    expect(await Bun.file(published).text()).toBe('{"type":"message"}\n');
    expect(await Bun.file(published.replace(/\.jsonl$/, ".title")).exists()).toBe(false);
    await writeFile(agent.path, '{"type":"message"}\n{"type":"update"}\n');
    await publishWorkspaceAgentHistory(named);
    expect(await Bun.file(published).text()).toContain("update");
    expect((await listWorkspaceAgentConversations("ws1"))).toEqual([named]);
    await rm(join(root, "workspaces", "ws1"), { recursive: true });
    expect(await Bun.file(published).text()).toContain("update");
  });

  test("project workspaces publish only named conversations into their shared project history", async () => {
    const root = await dataDir();
    await writeProjectInit("front", "frontend", "suite");
    await writeProjectInit("back", "backend", "suite");
    const front = await ensureDefaultWorkspaceAgentConversation("front");
    const back = await ensureDefaultWorkspaceAgentConversation("back");
    await setWorkspaceAgentConversationTitle(front, "Frontend work");
    await setWorkspaceAgentConversationTitle(back, "Backend work");
    expect((await Bun.file(join(root, "session-shares", "suite", `builtin--frontend-work--front--agent-1--${front.conversationId}.jsonl`)).exists())).toBe(true);
    expect((await Bun.file(join(root, "session-shares", "suite", `builtin--backend-work--back--agent-1--${back.conversationId}.jsonl`)).exists())).toBe(true);
  });

  test("ignores incomplete persisted project metadata", async () => {
    const root = await dataDir();
    const path = join(root, "workspaces", "ws1", "metadata");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "init.json"), JSON.stringify({ type: "project.git", sessionShareKey: "unvalidated-share" }));
    const agent = await ensureDefaultWorkspaceAgentConversation("ws1");
    await setWorkspaceAgentConversationTitle(agent, "Valid history");
    expect(await Bun.file(join(root, "session-shares", "projectless", `builtin--valid-history--ws1--agent-1--${agent.conversationId}.jsonl`)).exists()).toBe(true);
  });

  test("createNextWorkspaceAgentConversation creates lowest unused agent number and list sorts", async () => {
    const root = await dataDir();
    await ensureDefaultWorkspaceAgentConversation("ws1");
    const oldAgentPath = join(root, "session-shares", "projectless", "old-task--ws1--agent-10--268604ac-d16a-4a4a-ab1e-1ed3ca54687d.jsonl");
    await mkdir(join(root, "session-shares", "projectless"), { recursive: true });
    await writeFile(oldAgentPath, "");
    await writeFile(oldAgentPath.replace(/\.jsonl$/, ".title"), "Old task\n");
    await writeFile(join(root, "session-shares", "projectless", "notes.txt"), "ignored");
    const next = await createNextWorkspaceAgentConversation("ws1");
    expect(next.label).toBe("Agent 2");
    const agents = await listWorkspaceAgentConversations("ws1");
    expect(agents.map((agent) => agent.label)).toEqual(["Agent 1", "Agent 2", "Agent 10"]);
  });

  test("concurrent Agent creation assigns unique ordered labels", async () => {
    await dataDir();

    const [defaultA, defaultB] = await Promise.all([
      ensureDefaultWorkspaceAgentConversation("ws1"),
      ensureDefaultWorkspaceAgentConversation("ws1"),
    ]);
    const created = await Promise.all(Array.from({ length: 4 }, () => createNextWorkspaceAgentConversation("ws1")));

    expect(defaultA.conversationId).toBe(defaultB.conversationId);
    expect(created.map((agent) => agent.label)).toEqual(["Agent 2", "Agent 3", "Agent 4", "Agent 5"]);
    expect(new Set(created.map((agent) => agent.conversationId)).size).toBe(4);
    expect((await listWorkspaceAgentConversations("ws1")).map((agent) => agent.label)).toEqual(["Agent 1", "Agent 2", "Agent 3", "Agent 4", "Agent 5"]);
  });

  test("concurrent list readers observe a newly published conversation with its title", async () => {
    await dataDir();

    const creation = ensureDefaultWorkspaceAgentConversation("ws1");
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

  test("archiving an Agent conversation retains its transcript and title as history", async () => {
    await dataDir();
    const first = await ensureDefaultWorkspaceAgentConversation("ws1");
    const second = await createNextWorkspaceAgentConversation("ws1");
    await writeFile(second.path, '{"type":"message"}\n');

    await archiveWorkspaceAgentConversation(second);

    expect(await listWorkspaceAgentConversations("ws1")).toEqual([first]);
    expect(await Bun.file(second.path.replace(/\.jsonl$/, ".archived.jsonl")).text()).toBe('{"type":"message"}\n');
    expect(await Bun.file(second.path.replace(/\.jsonl$/, ".archived.title")).exists()).toBe(false);
  });

  test("archiving uses the current name even when its caller has an older title", async () => {
    const root = await dataDir();
    const original = await ensureDefaultWorkspaceAgentConversation("ws1");
    await writeFile(original.path, "saved history\n");
    await setWorkspaceAgentConversationTitle(original, "Named history");
    await archiveWorkspaceAgentConversation(original);
    expect(await Bun.file(join(root, "session-shares", "projectless", `builtin--named-history--ws1--agent-1--${original.conversationId}.archived.jsonl`)).text()).toBe("saved history\n");
    expect(await listWorkspaceAgentConversations("ws1")).toEqual([]);
  });

  test("replaces the Agent session behind an existing Agent conversation and archives the old session", async () => {
    await dataDir();
    const original = await ensureDefaultWorkspaceAgentConversation("ws1");
    await writeFile(original.path, '{"type":"message"}\n');

    const replacement = await replaceWorkspaceAgentSession(original);

    expect(replacement.label).toBe(original.label);
    expect(replacement.conversationId).toBe(original.conversationId);
    expect(replacement.path).toBe(original.path);
    expect(await Bun.file(replacement.path).text()).toBe("");
    expect(await Bun.file(original.path.replace(/\.jsonl$/, ".archived.jsonl")).text()).toBe('{"type":"message"}\n');
    expect(await listWorkspaceAgentConversations("ws1")).toEqual([replacement]);
  });

  test("replacing a named conversation retains the prior shared snapshot", async () => {
    const root = await dataDir();
    const original = await ensureDefaultWorkspaceAgentConversation("ws1");
    await writeFile(original.path, "first run\n");
    const named = await setWorkspaceAgentConversationTitle(original, "Named run");
    const replacement = await replaceWorkspaceAgentSession(original);
    expect(replacement.title).toBe(named.title);
    const shared = join(root, "session-shares", "projectless", `builtin--named-run--ws1--agent-1--${named.conversationId}`);
    expect(await Bun.file(`${shared}.archived.jsonl`).text()).toBe("first run\n");
    await writeFile(replacement.path, "second run\n");
    await publishWorkspaceAgentHistory(replacement);
    expect(await Bun.file(`${shared}.jsonl`).text()).toBe("second run\n");
  });

  test("concurrent list readers never observe the replacement gap used by /new", async () => {
    await dataDir();
    const original = await ensureDefaultWorkspaceAgentConversation("ws1");
    await writeFile(original.path, '{"type":"message"}\n');

    const replacement = replaceWorkspaceAgentSession(original);
    const readers = Array.from({ length: 8 }, () => listWorkspaceAgentConversations("ws1"));
    const [replaced, ...snapshots] = await Promise.all([replacement, ...readers]);

    for (const snapshot of snapshots) expect(snapshot).toEqual([replaced]);
  });

  test("slugs are filesystem friendly", () => {
    expect(sessionShareKeySlug("Product Suite")).toBe("product-suite");
    expect(sessionShareDir("Product Suite", "/tmp/data")).toBe("/tmp/data/session-shares/product-suite");
  });
});

describe("host-owned project onboarding permission", () => {
  test("persists for the lifetime of the workspace, including sibling and replacement agents", async () => {
    const root = await dataDir();
    await writeProjectInit("ws1", "repo-1234", "suite");
    markProjectOnboardingWorkspace("ws1");
    const agent = await ensureDefaultWorkspaceAgentConversation("ws1");
    expect(isProjectOnboardingWorkspace(agent.workspaceId)).toBe(true);
    expect(await Bun.file(join(root, "workspaces", "ws1", "metadata", "agent-capabilities.json")).json()).toEqual({ projectOnboarding: ["workspace"] });
    const [resumed] = await listWorkspaceAgentConversations("ws1");
    expect(isProjectOnboardingWorkspace(resumed!.workspaceId)).toBe(true);
    expect(isProjectOnboardingWorkspace((await replaceWorkspaceAgentSession(agent)).workspaceId)).toBe(true);
    expect(isProjectOnboardingWorkspace((await createNextWorkspaceAgentConversation("ws1")).workspaceId)).toBe(true);
    expect(isProjectOnboardingWorkspace("ws2")).toBe(false);
    await archiveWorkspaceAgentConversation(agent);
    const replacement = await ensureDefaultWorkspaceAgentConversation("ws1");
    expect(replacement.label).toBe("Agent 1");
    expect(isProjectOnboardingWorkspace(replacement.workspaceId)).toBe(true);
  });

  test("a transcript cannot opt a normal conversation in", async () => {
    await dataDir();
    const agent = await ensureDefaultWorkspaceAgentConversation("ws1");
    await writeFile(agent.path, JSON.stringify({ type: "custom", projectOnboarding: true }));
    await writeFile(agent.path.replace(/\.jsonl$/, ".capabilities.json"), JSON.stringify({ projectOnboarding: [agent.conversationId] }));
    expect(isProjectOnboardingWorkspace(agent.workspaceId)).toBe(false);
  });

  test("host initialization grants onboarding without changing the existing conversation", async () => {
    await dataDir();
    const agent = await ensureDefaultWorkspaceAgentConversation("ws1");
    expect(isProjectOnboardingWorkspace(agent.workspaceId)).toBe(false);
    markProjectOnboardingWorkspace("ws1");
    expect(await ensureDefaultWorkspaceAgentConversation("ws1")).toEqual(agent);
    expect(isProjectOnboardingWorkspace(agent.workspaceId)).toBe(true);
  });
});
