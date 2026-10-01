import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry } from "@earendil-works/pi-durable";
import { addProject, projectWorkspaceInit, readProjectWorkspaceSettings, type GitProjectInitInstruction } from "@atelier/projects";
import { createDurableOnboardingExtension, createRegisteredDurableOnboardingExtensions } from "../../src/server/durable-onboarding.ts";
import { createDurableBashExtension, type BashOperations, type BashOperationReceipt, type BashOperationRequest } from "../../src/server/durable-bash.ts";
import { openDurableWorkspace, type DurableWorkspace } from "../../src/server/durable-workspace.ts";
import { configureOnboardingTools, type OnboardingToolDependencies } from "../../src/server/onboarding-tools.ts";
import { markProjectOnboardingWorkspace } from "../../src/server/workspace-capabilities.ts";

const context = BACKGROUND_CONTEXT;
let path: string;
let previousData: string | undefined;
let source: GitProjectInitInstruction;
let destination: GitProjectInitInstruction;
let deps: OnboardingToolDependencies;
const workspaces: DurableWorkspace[] = [];
const create = mock<OnboardingToolDependencies["createWorkspace"]>(async (_init, _title, _signal, update) => {
  update?.({ content: [{ type: "text", text: "Provisioning" }], details: { phase: "provisioning" } });
  return { workspaceId: "child", url: "/workspaces/child", status: "ready", timings: { phases: [] } };
});
const remove = mock<OnboardingToolDependencies["deleteWorkspace"]>(async () => ({ deleted: true, blocked: false }));
const secret = mock<OnboardingToolDependencies["requestSecretValue"]>(async (_project, request) => ({ status: "cancelled", envName: request.envName }));
const done: BashOperationReceipt = { status: "done", exitCode: 0, aborted: false, timedOut: false, output: "remote result", displayAnsi: "remote result", fullOutputPath: "/remote/output" };
const operations = mock<(id: string) => BashOperations>(() => async () => done);

beforeEach(async () => {
  path = await mkdtemp(join(tmpdir(), "atelier-durable-onboarding-"));
  previousData = process.env.ATELIER_DATA_DIR;
  process.env.ATELIER_DATA_DIR = path;
  source = projectWorkspaceInit((await addProject("https://github.com/example/app.git")).project);
  destination = { ...source, createdBy: { workspaceId: "parent", conversationId: "owner" } };
  create.mockClear(); remove.mockClear(); secret.mockClear(); operations.mockClear();
  deps = {
    createWorkspace: create, deleteWorkspace: remove, requestSecretValue: secret,
    getWorkspaceInit: async (id) => id === "parent" ? source : id === "child" ? destination : undefined,
    createBashTool: () => { throw new Error("Native tools must not construct legacy bash"); },
  };
});
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.close()));
  configureOnboardingTools(undefined);
  if (previousData === undefined) delete process.env.ATELIER_DATA_DIR;
  else process.env.ATELIER_DATA_DIR = previousData;
  await rm(path, { recursive: true, force: true });
});

async function harness(remoteOperations = operations) {
  const models = createModels();
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  models.setProvider(faux.provider);
  function registry() {
    const registry = createRegistry();
    registry.install(createDurableBashExtension("parent", async () => { throw new Error("Must not execute on the source workspace"); }));
    registry.install(createDurableOnboardingExtension("parent", deps, remoteOperations));
    return registry;
  }
  async function open() {
    const workspace = await openDurableWorkspace(join(path, "journal"), "parent", { models, registry: registry() });
    workspaces.push(workspace);
    return workspace;
  }
  const workspace = await open();
  async function conversation(owner: string) {
    return workspace.conversation({ conversationId: owner, label: owner, title: "Onboarding" }, { model: { provider: "faux", modelId: "faux-1" } });
  }
  function responses(name: string, args: Record<string, JsonValue>) {
    faux.setResponses([fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }), fauxAssistantMessage("Done")]);
  }
  async function run(name: string, args: Record<string, JsonValue>, owner = "owner") {
    responses(name, args);
    const agent = await conversation(owner);
    const submission = await agent.submit({ type: "input", content: "Use the tool", requestId: crypto.randomUUID() }, context);
    expect((await submission.wait(context)).status).toBe("done");
    const entries = (await agent.entries({}, 100, undefined, context)).items;
    const result = entries.flatMap((entry) => entry.model ?? []).find((message) => message.role === "toolResult")!;
    return result;
  }
  return { workspace, open, conversation, responses, run };
}

test("native onboarding registration is host gated, with explicit replay policies and its remote task", () => {
  configureOnboardingTools(deps);
  expect(createRegisteredDurableOnboardingExtensions("durable-unmarked")).toEqual([]);
  markProjectOnboardingWorkspace("durable-marked");
  const [extension] = createRegisteredDurableOnboardingExtensions("durable-marked");
  expect(extension!.tools!.map((tool) => [tool.name, tool.replay])).toEqual([
    ["read_project_settings", "safe"], ["write_project_settings", "unsafe"], ["request_secret_value", "unsafe"],
    ["bash_in_other_workspace", "safe"], ["delete_workspace", "unsafe"], ["create_workspace", "unsafe"],
  ]);
  expect(extension!.tasks!.map((task) => task.definition.name)).toEqual(["atelier.remote-bash-operation"]);
  configureOnboardingTools(undefined);
  expect(createRegisteredDurableOnboardingExtensions("durable-marked")).toEqual([]);
});

test("native settings, creation, deletion and secure input use shared capabilities and persist their results", async () => {
  const h = await harness();
  expect((await h.run("read_project_settings", {})).isError).toBe(false);
  const original = await readProjectWorkspaceSettings(source.projectId);
  const settings = { dockerfile: "", preloadImages: ["redis:7"], environment: [] };
  expect((await h.run("write_project_settings", { expectedRevision: original.settingsRevision, settings })).isError).toBe(false);
  expect((await h.run("write_project_settings", { expectedRevision: original.settingsRevision, settings })).isError).toBe(true);
  const saved = await readProjectWorkspaceSettings(source.projectId);
  expect((await h.run("create_workspace", { title: "Try it", expectedRevision: saved.settingsRevision, settings }, "second-owner")).isError).toBe(false);
  expect(create.mock.calls[0]![0]).toMatchObject({ projectId: source.projectId, createdBy: { workspaceId: "parent", conversationId: "second-owner" } });
  expect((await h.run("request_secret_value", { envName: "TOKEN", purpose: "Check integration", hostPattern: "api.example.com" })).isError).toBe(false);
  expect(secret.mock.calls[0]![0]).toBe(source.projectId);
  expect((await h.run("delete_workspace", { workspace_id: "child", force: false })).isError).toBe(false);
  expect(remove).toHaveBeenCalledWith("child", false);
  const owner = await h.conversation("owner");
  const before = (await owner.entries({}, 100, undefined, context)).items;
  await h.workspace.close();
  const reopened = await h.open();
  const restored = await reopened.conversation({ conversationId: "owner", label: "owner", title: "Onboarding" });
  expect((await restored.entries({}, 100, undefined, context)).items).toEqual(before);
  const journal = await readFile(join(path, "journal/main.jsonl"), "utf8");
  expect(journal).toContain("/workspaces/child");
  expect(journal).toContain("settingsRevision");
});

test("one registry isolates remote bash and deletion by conversation, parent and project before effects", async () => {
  const h = await harness();
  for (const tool of ["bash_in_other_workspace", "delete_workspace"]) {
    const args: Record<string, JsonValue> = tool === "delete_workspace" ? { force: true } : { command: "touch should-not-run" };
    for (const workspace_id of ["parent", "unknown"]) {
      expect((await h.run(tool, { ...args, workspace_id })).isError).toBe(true);
    }
    expect((await h.run(tool, { ...args, workspace_id: "child" }, "sibling")).isError).toBe(true);
    for (const target of [
      { ...destination, projectId: "another-project" },
      { ...destination, createdBy: { workspaceId: "other-parent", conversationId: "owner" } },
      { ...destination, createdBy: undefined },
    ]) {
      const original = destination;
      destination = target;
      expect((await h.run(tool, { ...args, workspace_id: "child" })).isError).toBe(true);
      destination = original;
    }
  }
  expect(operations).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  const result = await h.run("bash_in_other_workspace", { workspace_id: "child", command: "pwd", timeout: 20 });
  expect(result.isError).toBe(false);
  expect(result.content).toEqual([{ type: "text", text: "remote result" }]);
  expect(operations.mock.calls.every(([id]) => id === "child")).toBe(true);
});

test.each(["shutdown", "stop"] as const)("remote bash %s retains its admitted destination, operation and deadline across reopen", async (action) => {
  let launched!: () => void;
  const admitted = new Promise<void>((resolve) => { launched = resolve; });
  const calls: Array<{ id: string; action: string; request: BashOperationRequest; create: boolean }> = [];
  let completed = false;
  const remote = mock<(id: string) => BashOperations>((id) => async (action, request, create = false) => {
    calls.push({ id, action, request, create });
    if (action === "stop") completed = true;
    if (action === "ensure") launched();
    return completed ? done : { status: "running", session: `atelier-agent-${request.id}` };
  });
  const h = await harness(remote);
  h.responses("bash_in_other_workspace", { workspace_id: "child", command: "sleep 1; echo hello", timeout: 30 });
  const owner = await h.conversation("owner");
  const submission = await owner.submit({ type: "input", content: "Run", requestId: "original" }, context);
  await admitted;
  // No new admission may use this changed metadata. Already-admitted operations
  // retain authority to reconnect/Stop; they cannot accidentally switch targets.
  destination = { ...destination, createdBy: undefined };
  if (action === "stop") await owner.abort(context);
  await h.workspace.close();
  expect(calls.some((call) => call.action === "stop")).toBe(action === "stop");
  completed = true;
  const reopened = await h.open();
  const restored = (await reopened.harness.submission(submission.id, context))!;
  expect((await restored.wait(context)).status).toBe(action === "stop" ? "unanswered" : "done");
  expect(calls.filter((call) => call.create)).toHaveLength(1);
  expect(calls.every((call) => call.id === "child")).toBe(true);
  expect(new Set(calls.map((call) => JSON.stringify(call.request))).size).toBe(1);
  if (action === "shutdown") expect(calls.filter((call) => call.action === "ensure")).toHaveLength(2);
});
