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
      let reviewNotifications = true;
      let goal = null;
      let skills = { data: [] };
      let plugins = { marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] };
      let mcpPages = [{ data: [], nextCursor: null }];
      let appPages = [{ data: [], nextCursor: null }];
      const turn = (id, status = "completed") => ({ id, status, items: [], itemsView: "full", error: null, startedAt: 100, completedAt: status === "inProgress" ? null : 101, durationMs: 1000 });
      const setupPath = ${JSON.stringify(join(import.meta.dir, "../src/server/setup.ts"))};
      mock.module(setupPath, () => ({
        agentTypeId: "codex-app-server", label: "Codex Native", codexHome: id => "/codex/" + id,
        prepareCodex: async () => ({ instructions: "instructions", mcp: { url: "http://localhost/mcp", token: "test" } }), requireSetup: async () => {},
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
              if (method === "thread/fork") return { thread: { id: "forked-thread", turns: [...turns] }, model: "model", reasoningEffort: "medium" };
              if (method === "thread/list") return { data: [{ id: "saved-thread", turns: [] }], nextCursor: params.cursor ? null : "next-page", backwardsCursor: null };
              if (method === "review/start") { const value = turn("review", "inProgress"); turns.push(value); if (reviewNotifications) notification({ method: "turn/started", params: { threadId: params.threadId, turn: value } }); return { turn: turn("review-operation", "inProgress"), reviewThreadId: params.threadId }; }
              if (method === "thread/goal/set") { goal = { ...(goal ?? {}), objective: params.objective ?? goal?.objective, status: params.status }; return { goal }; }
              if (method === "thread/goal/get") return { goal };
              if (method === "thread/goal/clear") { goal = null; return { cleared: true }; }
              if (method === "skills/list") return skills;
              if (method === "hooks/list") return { data: [] };
              if (method === "plugin/list") return plugins;
              if (method === "plugin/install") return { appsNeedingAuth: [] };
              if (method === "skills/config/write") { for (const entry of skills.data) for (const skill of entry.skills) if (skill.path === params.path) skill.enabled = params.enabled; return { effectiveEnabled: params.enabled }; }
              if (method === "config/value/write") return { status: "ok" };
              if (method === "mcpServerStatus/list") return mcpPages[params.cursor ? 1 : 0];
              if (method === "app/list") return appPages[params.cursor ? 1 : 0];
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

test("compaction and review use native RPCs and reject unsafe active-turn operations", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  await runtime.command({ kind: "compact" }, "compact");
  expect(requests.find(value => value.method === "thread/compact/start").params).toEqual({ threadId: "thread-1" });
  expect(requests.some(value => value.method === "turn/start")).toBe(false);
  await runtime.command({ kind: "review", target: { type: "baseBranch", branch: "main" } }, "review");
  expect(requests.find(value => value.method === "review/start").params).toEqual({ threadId: "thread-1", target: { type: "baseBranch", branch: "main" }, delivery: "inline" });
  expect(runtime.isBusy).toBe(true);
  for (const command of [{ kind: "compact" }, { kind: "fork" }, { kind: "resume" }, { kind: "review" }]) await expect(runtime.command(command, "busy")).rejects.toThrow("Stop Codex");
  await agents.disposeAll();
`));

test("fork and resume persist the selected native thread even without prompt submissions", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  await runtime.command({ kind: "fork" }, "fork");
  expect(runtime.record.threadId).toBe("forked-thread");
  const listed = await runtime.command({ kind: "resume", cursor: "next-page" }, "list");
  expect(listed.kind).toBe("resume");
  expect(requests.find(value => value.method === "thread/list").params).toMatchObject({ cwd: "/work", cursor: "next-page" });
  await runtime.command({ kind: "resume", threadId: "saved-thread" }, "resume");
  expect(runtime.record.threadId).toBe("saved-thread");
  connections[0].failed(new Error("Disconnected"));
  await agents.ready("workspace", id);
  expect(requests.filter(value => value.method === "thread/resume").map(value => value.params.threadId)).toEqual(["saved-thread", "saved-thread"]);
  expect(runtime.record.submissions).toHaveLength(0);
  await agents.disposeAll();
`));

test("goal actions update Codex native state and preserve the materialized thread", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  expect(await runtime.command({ kind: "goal" }, "show")).toEqual({ kind: "goal", goal: null });
  await runtime.command({ kind: "goal", objective: "Finish the task" }, "set");
  expect(runtime.record.threadId).toBe("thread-1");
  expect(goal).toEqual({ objective: "Finish the task", status: "active" });
  await runtime.command({ kind: "goal", status: "paused" }, "pause");
  expect(goal).toEqual({ objective: "Finish the task", status: "paused" });
  expect(await runtime.command({ kind: "goal", clear: true }, "clear")).toEqual({ kind: "goal", goal: null });
  expect(requests.some(value => value.method === "turn/start")).toBe(false);
  await agents.disposeAll();
`));

test("skill selection sends a validated native skill reference, never an arbitrary path", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  skills = { data: [{ cwd: "/work", skills: [{ name: "example", path: "/work/.agents/skills/example/SKILL.md", enabled: true }], errors: [] }] };
  await runtime.command({ kind: "skills", name: "example" }, "use-skill");
  const sent = requests.find(value => value.method === "turn/start");
  expect(sent.params.input.at(-1)).toEqual({ type: "skill", name: "example", path: "/work/.agents/skills/example/SKILL.md" });
  await runtime.command({ kind: "skills", name: "example" }, "use-skill");
  expect(requests.filter(value => value.method === "turn/start")).toHaveLength(1);
  skills.data[0].skills[0].enabled = false;
  await expect(runtime.command({ kind: "skills", name: "example" }, "disabled")).rejects.toThrow("enabled Codex skill");
  await agents.disposeAll();
`));

test("native catalogs include every page and inspection never submits a prompt", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  mcpPages = [{ data: [{ name: "first" }], nextCursor: "more" }, { data: [{ name: "second" }], nextCursor: null }];
  appPages = [{ data: [{ id: "first" }], nextCursor: "more" }, { data: [{ id: "second" }], nextCursor: null }];
  expect((await runtime.command({ kind: "mcp", verbose: true }, "mcp")).servers.map(value => value.name)).toEqual(["first", "second"]);
  expect((await runtime.command({ kind: "apps" }, "apps")).apps.map(value => value.id)).toEqual(["first", "second"]);
  for (const kind of ["skills", "hooks", "plugins"]) expect((await runtime.command({ kind }, kind)).kind).toBe(kind);
  expect(requests.some(value => value.method === "turn/start")).toBe(false);
  await agents.disposeAll();
`));

test("slash-command HTTP operations expose native results rather than send literal commands", () => scenario(`
  const id = await agents.create("workspace");
  const { codexRoutes } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/routes.ts"))});
  const route = codexRoutes(agents);
  const url = new URL("http://localhost/workspaces/workspace/codex-app-server-agents/" + id + "/messages");
  const response = await route(new Request(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ text: "/mcp" }) }), url);
  expect(response.status).toBe(200);
  expect((await response.json()).command.kind).toBe("mcp");
  expect(requests.some(value => value.method === "turn/start")).toBe(false);
  await agents.disposeAll();
`));

test("form commands accept absent pagination fields and validate native skill choices", () => scenario(`
  const id = await agents.create("workspace");
  const { codexRoutes } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/routes.ts"))});
  const route = codexRoutes(agents);
  const url = new URL("http://localhost/workspaces/workspace/codex-app-server-agents/" + id + "/commands");
  const body = new FormData(); body.set("text", "/resume");
  const response = await route(new Request(url, { method: "POST", body }), url);
  expect(response.status).toBe(200);
  expect(requests.find(value => value.method === "thread/list").params.cursor).toBeUndefined();
  skills = { data: [{ cwd: "/work", skills: [{ name: "example", path: "/work/.agents/skills/example/SKILL.md", enabled: true }], errors: [] }] };
  const forged = new FormData(); forged.set("text", "/skills example"); forged.set("skillPath", "/tmp/unlisted/SKILL.md");
  await expect(route(new Request(url, { method: "POST", body: forged }), url)).rejects.toThrow("enabled Codex skill");
  expect(requests.some(value => value.method === "turn/start")).toBe(false);
  await agents.disposeAll();
`));


test("skill settings validate inventory paths and use Codex’s persistent configuration", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  const path = "/work/.agents/skills/example/SKILL.md";
  skills = { data: [{ cwd: "/work", skills: [{ name: "example", path, enabled: false }], errors: [] }] };
  await expect(runtime.command({ kind: "skills", name: "example", path: "/tmp/forged", enabled: true }, "forged")).rejects.toThrow("native Codex catalog");
  const result = await runtime.command({ kind: "skills", name: "example", path, enabled: true }, "enable");
  expect(result.skills.data[0].skills[0].enabled).toBe(true);
  expect(requests.filter(value => value.method === "skills/config/write")).toEqual([{ method: "skills/config/write", params: { path, enabled: true } }]);
  expect(requests.some(value => value.method === "turn/start")).toBe(false);
  await agents.disposeAll();
`));

test("plugin and app mutations resolve native catalog identities before writing settings", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  plugins.marketplaces = [{ name: "curated", path: null, plugins: [{ id: "example@curated", name: "example" }] }];
  appPages = [{ data: [{ id: "connector_example" }], nextCursor: null }];
  await expect(runtime.command({ kind: "plugins", action: "install", id: "forged" }, "forged-plugin")).rejects.toThrow("native Codex catalog");
  await expect(runtime.command({ kind: "apps", enabled: true, id: "forged" }, "forged-app")).rejects.toThrow("native Codex catalog");
  await runtime.command({ kind: "plugins", action: "install", id: "example@curated" }, "install");
  expect(requests.find(value => value.method === "plugin/install").params).toEqual({ pluginName: "example", marketplacePath: null, remoteMarketplaceName: "curated", installAttemptId: "install" });
  await runtime.command({ kind: "plugins", action: "uninstall", id: "example@curated" }, "uninstall");
  expect(requests.find(value => value.method === "plugin/uninstall").params).toEqual({ pluginId: "example@curated" });
  await runtime.command({ kind: "apps", enabled: false, id: "connector_example" }, "disable");
  expect(requests.find(value => value.method === "config/value/write").params).toEqual({ keyPath: 'apps."connector_example".enabled', value: false, mergeStrategy: "replace" });
  expect(requests.some(value => value.method === "turn/start")).toBe(false);
  await agents.disposeAll();
`));


test("review operation IDs never become phantom turns and pending starts stay busy", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  reviewNotifications = false;
  await runtime.command({ kind: "review", target: { type: "uncommittedChanges" } }, "review");
  expect(runtime.isBusy).toBe(true);
  expect(runtime.state.turns).toHaveLength(0);
  connections[0].notification({ method: "item/completed", params: { threadId: "thread-1", turnId: "review", item: { type: "enteredReviewMode", id: "review-mode", review: "current changes" } } });
  expect(runtime.state.activeTurn.id).toBe("review");
  turns[0] = turn("review");
  connections[0].notification({ method: "turn/completed", params: { threadId: "thread-1", turn: turns[0] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(runtime.isBusy).toBe(false);
  expect(runtime.state.turns.map(value => value.id)).toEqual(["review"]);
  await agents.disposeAll();
`));


test("native new starts a Codex thread without submitting an inference prompt", () => scenario(`
  const id = await agents.create("workspace");
  const runtime = await agents.ready("workspace", id);
  const result = await runtime.command({ kind: "new" }, "new");
  expect(result.kind).toBe("done");
  expect(requests.filter(value => value.method === "thread/start")).toHaveLength(2);
  expect(requests.some(value => value.method === "turn/start")).toBe(false);
  expect(runtime.state.turns).toHaveLength(0);
  await agents.disposeAll();
`));
