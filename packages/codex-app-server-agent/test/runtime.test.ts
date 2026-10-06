import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep transport mocks and workspace metadata isolated from other packages.
async function scenario(script: string) {
  const directory = await mkdtemp(join(tmpdir(), "codex-runtime-"));
  try {
    const child = Bun.spawn([process.execPath, "-e", `
      import { expect, mock } from "bun:test";
      const connections = [];
      const requests = [];
      const turns = [];
      let resumeError;
      const turn = (id, status = "completed") => ({ id, status, items: [], itemsView: "full", error: null, startedAt: 100, completedAt: status === "inProgress" ? null : 101, durationMs: 1000 });
      const setupPath = ${JSON.stringify(join(import.meta.dir, "../src/server/setup.ts"))};
      mock.module(setupPath, () => ({
        agentTypeId: "codex-app-server", label: "Codex Native", codexHome: id => "/codex/" + id,
        prepareCodex: async () => "instructions", requireSetup: async () => {},
        settings: { prepare: async () => ({ model: "openai-codex::model", thinkingLevel: "medium" }), renderFooter: async () => "" },
      }));
      mock.module(${JSON.stringify(join(import.meta.dir, "../src/server/transport.ts"))}, () => ({
        openCodexTransport: async (workspaceId, home, notification, failed) => {
          const connection = { notification, failed, closed: false, rpc: {
            notify() {}, async request(method, params) {
              requests.push({ method, params });
              if (method === "initialize") return {};
              if (method === "model/list") return { data: [{ model: "model", hidden: false, displayName: "Model", defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }], nextCursor: null };
              if (method === "thread/resume" && resumeError) throw resumeError;
              if (method === "thread/start" || method === "thread/resume") return { thread: { id: params.threadId ?? "thread-" + connections.length, turns: [...turns] }, model: "model", reasoningEffort: "medium" };
              if (method === "turn/start") { const value = turn("turn-" + turns.length); turns.push(value); return { turn: value }; }
              if (method === "thread/read") return { thread: { turns: [...turns] } };
              return {};
            },
          }, async close() { this.closed = true; } };
          connections.push(connection);
          return connection;
        },
      }));
      const rendering = await import(${JSON.stringify(join(import.meta.dir, "../src/server/render.ts"))});
      mock.module(${JSON.stringify(join(import.meta.dir, "../src/server/render.ts"))}, () => ({ ...rendering, liveRegions: runtime => [{ target: "state", html: JSON.stringify(runtime.state.turns) }] }));
      const busy = await import("@agents-in-the-cloud/agent/server/workspace-agent-busy");
      mock.module("@agents-in-the-cloud/agent/server/workspace-agent-busy", () => ({ ...busy, publishWorkspaceAgentBusy() {} }));
      const handlers = new Map();
      const events = { on(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); }, async emit(name, payload) { for (const handler of handlers.get(name) ?? []) await handler(payload); } };
      const { createCodexAgents } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/runtime.ts"))});
      const agents = createCodexAgents(() => events);
      const input = { text: "hello", images: [], attachmentNotes: [] };
      ${script}
    `], { cwd: join(import.meta.dir, ".."), env: { ...process.env, ATELIER_DATA_DIR: directory }, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("concurrent acquisitions resume a failed runtime once and preserve its subscribers", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  await runtime.send(input, "first");
  const publications = [];
  const subscription = runtime.presentation.subscribe(value => publications.push(value));
  connections[0].failed(new Error("Disconnected"));
  const recovered = await Promise.all([agents.ready("workspace", id), agents.ready("workspace", id)]);
  expect(recovered).toEqual([runtime, runtime]);
  expect(connections).toHaveLength(2);
  expect(connections[0].closed).toBe(true);
  expect(requests.filter(value => value.method === "thread/resume")).toHaveLength(1);
  expect(runtime.failure).toBeUndefined();
  expect(runtime.selection.models).toHaveLength(1);
  await runtime.send(input, "second");
  runtime.presentation.flush();
  expect(publications).toHaveLength(2);
  expect(runtime.state.turns).toHaveLength(2);
  subscription.unsubscribe();
  await agents.disposeAll();
`));

test("failed recovery remains visible and a later acquisition can retry it", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  await runtime.send(input, "first");
  connections[0].failed(new Error("Disconnected"));
  resumeError = new Error("Resume failed");
  await expect(agents.ready("workspace", id)).rejects.toThrow("Resume failed");
  expect(runtime.failure.message).toBe("Resume failed");
  resumeError = undefined;
  expect(await agents.ready("workspace", id)).toBe(runtime);
  expect(connections).toHaveLength(3);
  expect(connections[1].closed).toBe(true);
  await agents.disposeAll();
`));

test("reveal resolves nested activity to its owning turn, but not final answers", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  runtime.state.hydrate([{ ...turn("working"), items: [
    { type: "reasoning", id: "reasoning", summary: ["Thinking"], content: [] },
    { type: "commandExecution", id: "command", command: "pwd", status: "completed", aggregatedOutput: "/work", durationMs: 1, exitCode: 0 },
    { type: "userMessage", id: "initial", clientId: "initial", content: [] },
    { type: "userMessage", id: "steering", clientId: "steering", content: [] },
    { type: "agentMessage", id: "answer", text: "Done", phase: "final_answer" },
  ] }]);
  const { codexRoutes } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/routes.ts"))});
  const route = codexRoutes(agents);
  const reveal = async key => { const url = new URL("http://localhost/workspaces/workspace/codex-app-server-agents/" + id + "/reveal/" + key); return (await route(new Request(url), url)).json(); };
  for (const key of ["reasoning", "command", "steering"]) expect(await reveal(key)).toEqual({ turnId: "working" });
  for (const key of ["initial", "answer", "missing"]) expect(await reveal(key)).toEqual({ turnId: null });
  await agents.disposeAll();
`));

test("completion requests workspace attention only for this module's agents", () => scenario(`
  const attention = [];
  const { agentsInTheCloudServerModule: module } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/index.ts"))});
  module.initialize({ events, registry: { requestAttention: id => attention.push(id) }, onWorkspaceRemoved() {} });
  const id = await module.agentType.create({ workspaceId: "workspace" });
  await events.emit("workspace_agent_turn_finished", { workspaceId: "workspace", agentId: id });
  await events.emit("workspace_agent_turn_finished", { workspaceId: "workspace", agentId: "builtin" });
  await events.emit("workspace_agent_turn_finished", { workspaceId: "other", agentId: id });
  expect(attention).toEqual(["workspace"]);
  await events.emit("agents_in_the_cloud_host_stopping", {});
`));
