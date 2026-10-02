import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createRegistry } from "@earendil-works/pi-durable";
import { NativeAgentRuntime } from "../../src/server/native-agent-runtime.ts";
import { openDurableAgentRuntime } from "../../src/server/durable-runtime.ts";
import { durableWorkspaceOwner, suspendAllDurableWorkspaceOwners } from "../../src/server/durable-owner.ts";
import { getWorkspaceAgentRuntime, unloadWorkspaceAgentRuntime, closeWorkspaceAgentConversation, removeWorkspaceAgentRuntimes, suspendWorkspaceAgentRuntimes, allowWorkspaceAgentResume } from "../../src/server/runtime.ts";
import { archiveWorkspaceAgentConversation, ensureDefaultWorkspaceAgentConversation, listWorkspaceAgentConversations, setWorkspaceAgentConversationTitle } from "../../src/server/session-store.ts";

const originalDataDir = process.env.ATELIER_DATA_DIR;
let directory: string;
afterEach(async () => {
  await suspendAllDurableWorkspaceOwners();
  if (originalDataDir === undefined) delete process.env.ATELIER_DATA_DIR;
  else process.env.ATELIER_DATA_DIR = originalDataDir;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("production dispatch reattaches native journal, deduplicates passively, retains titles and fences close/delete", async () => {
  directory = await mkdtemp(join(tmpdir(), "native-dispatch-"));
  process.env.ATELIER_DATA_DIR = directory;
  const workspaceId = `native-${crypto.randomUUID()}`;
  const agent = await ensureDefaultWorkspaceAgentConversation(workspaceId);
  const models = createModels();
  const faux = fauxProvider({ tokensPerSecond: 100_000, models: [{ id: "test" }] });
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Persisted answer")]);
  const initial = await openDurableAgentRuntime(agent.path, workspaceId, {}, {
    harness: async () => ({ models, registry: createRegistry() }),
    prepare: async () => ({ model: { provider: "faux", modelId: "test" }, thinkingLevel: "off" }),
    expand: async (_workspace, text) => text, ready: async () => {},
  });
  const controller = await initial.conversation(agent);
  await (await controller.submit({ text: "Persisted request", requestId: "admitted" })).wait(BACKGROUND_CONTEXT);
  await initial.suspend();

  const [runtime, same] = await Promise.all([getWorkspaceAgentRuntime(agent), getWorkspaceAgentRuntime(agent)]);
  expect(runtime).toBeInstanceOf(NativeAgentRuntime);
  expect(runtime).toBe(same);
  expect(runtime.userMessages()).toEqual(["Persisted request"]);
  expect(await runtime.knownRequest!("admitted")).toBe(true);
  // No container or available Faux auth exists. A duplicate still succeeds.
  await runtime.submit("Different retry", { requestId: "admitted" });
  expect(runtime.currentModel()).toEqual({ provider: "faux", id: "test" });
  const named = await setWorkspaceAgentConversationTitle(agent, "Retained native title");
  expect((await (await durableWorkspaceOwner(workspaceId)).catalog())[0]!.title).toBe(named.title);
  const disposing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const originalDispose = runtime.dispose.bind(runtime);
  const dispose = spyOn(runtime, "dispose").mockImplementation(async () => { disposing.resolve(); await release.promise; await originalDispose(); });
  const unloading = unloadWorkspaceAgentRuntime(workspaceId, agent.conversationId);
  await disposing.promise;
  let mounted = false;
  const mounting = getWorkspaceAgentRuntime(named).then(value => { mounted = true; return value; });
  await Bun.sleep(5);
  expect(mounted).toBe(false);
  release.resolve();
  await unloading;
  dispose.mockRestore();
  const reopened = await mounting;
  expect(reopened).not.toBe(runtime);
  expect(reopened.userMessages()).toEqual(["Persisted request"]);
  // Park and close overlap: closure must reopen passively after disposal and
  // persist its fence rather than operating on a just-suspended owner.
  const parking = suspendWorkspaceAgentRuntimes(workspaceId);
  const closing = closeWorkspaceAgentConversation(workspaceId, agent.conversationId);
  await parking;
  await closing;
  allowWorkspaceAgentResume(workspaceId);
  expect((await (await durableWorkspaceOwner(workspaceId)).admission())?.closed).toContain(controller.id);
  await archiveWorkspaceAgentConversation(named);
  expect(await listWorkspaceAgentConversations(workspaceId)).toEqual([]);
  // Deletion must fence the retained owner even when no mounted tabs remain.
  await removeWorkspaceAgentRuntimes(workspaceId);
  const retained = await durableWorkspaceOwner(workspaceId);
  const history = await retained.conversation(named);
  expect((await history.history({}, 100, undefined, BACKGROUND_CONTEXT)).items.length).toBeGreaterThan(0);
  await expect(history.knownRequest("admitted")).rejects.toThrow("deleted");
  expect(faux.state.callCount).toBe(1);
});
