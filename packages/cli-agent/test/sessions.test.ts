import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate dependency mocks and metadata caches; exercise the public module interface.
async function scenario(script: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "cli-agent-"));
  try {
    const child = Bun.spawn([process.execPath, "-e", `
      import { expect, mock } from "bun:test";
      const workspace = await import("@agents-in-the-cloud/workspace");
      const calls = [];
      const launches = [];
      const preparations = [];
      let setupError;
      let preparationError;
      let inspectionResult;
      let result = { stdout: "", stderr: "", exitCode: 0, durationMs: 0 };
      mock.module("@agents-in-the-cloud/workspace", () => ({ ...workspace, execWorkspaceShell: async (...args) => { calls.push(args); return args[1].includes("tmux list-panes") && inspectionResult ? inspectionResult : result; } }));
      const agentServer = await import("@agents-in-the-cloud/agent/server");
      const slugRequests = [];
      let suggestedSlug;
      let slugDelay;
      mock.module("@agents-in-the-cloud/agent/server", () => ({ ...agentServer, suggestSessionSlug: async (...args) => { slugRequests.push(args); await slugDelay?.promise; return suggestedSlug; } }));
      const { createCliAgentModule } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/index.ts"))});
      const adapter = {
        id: "example", label: "Example CLI", iconHtml: "",
        requireSetup: async () => { if (setupError) throw setupError; },
        settings: {
          renderFooter: async () => "",
          prepare: async (settings = {}) => settings,
        },
        prepareWorkspace: async (workspaceId) => { preparations.push(workspaceId); if (preparationError) throw preparationError; },
        launchScript: (input, images, settings) => { launches.push({ input, images, settings }); return "printf 'CLI started'"; },
      };
      const module = createCliAgentModule(adapter);
      const titleEvents = [];
      module.initialize({ events: { on() {}, emit: async (name, payload) => { titleEvents.push({ name, payload }); } }, registerSocketHandler() {} });
      const provider = module.agentProvider;
      const saved = (workspaceId, providerId = "example") => Bun.file(process.env.ATELIER_DATA_DIR + "/workspaces/" + workspaceId + "/metadata/" + providerId + "-agents.json").json();
      const list = (workspaceId) => provider.tabs.list({ workspaceId });
      ${script}
    `], { cwd: join(import.meta.dir, ".."), env: { ...process.env, ATELIER_DATA_DIR: directory }, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("creation materializes images and passes input and settings to the adapter once", () => scenario(`
  const input = { text: "Inspect this image", images: [{ mimeType: "image/png", data: "aW1hZ2U=" }], attachmentNotes: ["File: /work/notes.txt"] };
  const settings = { input, model: "any-provider::model", thinkingLevel: "custom", serviceTier: "fast" };
  await provider.launch.prepareWorkspace("initial", { agent: settings });
  const [tab] = await list("initial");
  expect(calls).toHaveLength(4);
  const image = "/tmp/agents-in-the-cloud-attachments/example-" + tab.id + "/0.png";
  expect(calls[0][1]).toContain(image);
  expect(calls[0][2]).toEqual({ stdin: "aW1hZ2U=" });
  expect(calls[3][1]).toContain("tmux -N new-session");
  expect(launches).toEqual([{ input, images: [image], settings }]);
  expect(preparations).toEqual(["initial"]);
  const [session] = (await saved("initial")).sessions;
  expect(session).toMatchObject({ id: tab.id, title: "Example CLI", input, kind: "example", model: settings.model, thinkingLevel: "custom", tmuxSession: "example-" + tab.id });
  await list("initial");
  expect(calls).toHaveLength(4);
`));

test("a launch prompt names the tab with a suggested slug", () => scenario(`
  suggestedSlug = "inspect-attached-image";
  const input = { text: "Inspect this image", images: [], attachmentNotes: [] };
  await provider.launch.prepareWorkspace("named", { agent: { input, model: "any-provider::model" } });
  const [tab] = await list("named");
  while (!titleEvents.length) await Bun.sleep(1);
  expect(slugRequests).toEqual([[input.text, { provider: "any-provider", id: "model" }]]);
  expect(await list("named")).toEqual([{ id: tab.id, title: suggestedSlug }]);
  expect((await saved("named")).sessions[0].historySlug).toBe(suggestedSlug);
  expect(titleEvents).toEqual([{ name: "workspace_agent_conversation_title_changed", payload: { workspaceId: "named", conversationId: tab.id, title: suggestedSlug } }]);
`));

test("CLI composer /name renames the tab without sending text to the terminal", () => scenario(`
  const id = await provider.create({ workspaceId: "rename" });
  const route = module.routes[0].handle;
  const url = new URL("http://localhost/workspaces/rename/example-agents/" + id + "/composer");
  const { agentAttachmentDraftId } = await import("@agents-in-the-cloud/prompt/server");
  const form = (text) => new Request(url, { method: "POST", body: new URLSearchParams({ text, attachmentDraft: agentAttachmentDraftId("rename", "example:" + id) }) });
  const explicit = await route(form("/name manual-title"), url);
  expect(explicit.status).toBe(204);
  expect(await list("rename")).toEqual([{ id, title: "manual-title" }]);
  expect((await saved("rename")).sessions[0].historySlug).toBe("manual-title");
  expect((await saved("rename")).sessions[0].input.text).toBe("");
  expect(titleEvents).toEqual([{ name: "workspace_agent_conversation_title_changed", payload: { workspaceId: "rename", conversationId: id, title: "manual-title" } }]);
  expect((await route(form("/name"), url)).status).toBe(422);
  expect(await list("rename")).toEqual([{ id, title: "manual-title" }]);
`));

test("a late automatic title cannot replace a manual CLI /name", () => scenario(`
  suggestedSlug = "automatic-title";
  slugDelay = Promise.withResolvers();
  await provider.launch.prepareWorkspace("race", { agent: { input: { text: "Investigate the timeout", images: [], attachmentNotes: [] } } });
  const [{ id }] = await list("race");
  while (!slugRequests.length) await Bun.sleep(1);
  const url = new URL("http://localhost/workspaces/race/example-agents/" + id + "/composer");
  const { agentAttachmentDraftId } = await import("@agents-in-the-cloud/prompt/server");
  const response = await module.routes[0].handle(new Request(url, { method: "POST", body: new URLSearchParams({ text: "/name manual-title", attachmentDraft: agentAttachmentDraftId("race", "example:" + id) }) }), url);
  expect(response.status).toBe(204);
  slugDelay.resolve();
  await Bun.sleep(20);
  expect(await list("race")).toEqual([{ id, title: "manual-title" }]);
  expect((await saved("race")).sessions[0].historySlug).toBe("manual-title");
  expect(titleEvents).toHaveLength(1);
`));

test("CLI composer /name uses the saved prompt when no title is supplied", () => scenario(`
  const id = await provider.create({ workspaceId: "context" });
  const url = new URL("http://localhost/workspaces/context/example-agents/" + id + "/composer");
  const { agentAttachmentDraftId } = await import("@agents-in-the-cloud/prompt/server");
  const form = (text) => new Request(url, { method: "POST", body: new URLSearchParams({ text, attachmentDraft: agentAttachmentDraftId("context", "example:" + id) }) });
  expect((await module.routes[0].handle(form("Investigate the timeout"), url)).status).toBe(200);
  suggestedSlug = "investigate-timeout";
  const response = await module.routes[0].handle(form("/name"), url);
  expect(response.status).toBe(204);
  expect(slugRequests).toEqual([["Investigate the timeout", undefined]]);
  expect(await list("context")).toEqual([{ id, title: "investigate-timeout" }]);
`));

test("startup failure leaves a durable tab with its actual error", () => scenario(`
  result = { ...result, stderr: "tmux service unavailable", exitCode: 1 };
  const id = await provider.create({ workspaceId: "failure" });
  expect((await saved("failure")).sessions[0]).toMatchObject({ id, error: "tmux service unavailable" });
  expect(await list("failure")).toEqual([{ id, title: "Example CLI" }]);
`));

test("adapter preparation failures are retained without launching a process", () => scenario(`
  preparationError = new Error("credentials could not be installed");
  await provider.create({ workspaceId: "failure" });
  expect((await saved("failure")).sessions[0].error).toBe(preparationError.message);
  expect(calls).toHaveLength(0);
  expect(launches).toHaveLength(0);
  await provider.launch.prepareWorkspace("failure");
  expect(preparations).toHaveLength(1);
`));

test("ended process retains its terminal until the tab is closed", () => scenario(`
  const id = await provider.create({ workspaceId: "ended" });
  result = { ...result, stdout: "1:42\\n" };
  const { createCliSessions } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/sessions.ts"))});
  const sessions = createCliSessions(adapter);
  expect(await sessions.terminalState("ended", sessions.get("ended", id))).toMatchObject({ ended: true, exitCode: 42 });
  expect(calls.some(call => call[1].includes("kill-session"))).toBe(false);
  await provider.tabs.close({ workspaceId: "ended", conversationId: id });
  expect(calls.at(-1)[1]).toContain("tmux kill-session");
  expect(await list("ended")).toEqual([]);
`));

test("missing session closes without restarting or trying to kill it", () => scenario(`
  const id = await provider.create({ workspaceId: "missing" });
  calls.length = 0;
  result = { ...result, stderr: "can't find session", exitCode: 1 };
  await provider.tabs.close({ workspaceId: "missing", conversationId: id });
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toContain("tmux list-panes");
  expect(await list("missing")).toEqual([]);
  expect(launches).toHaveLength(1);
`));

test("unexpected inspection errors propagate and preserve the tab", () => scenario(`
  const id = await provider.create({ workspaceId: "broken" });
  result = { ...result, stderr: "container unavailable", exitCode: 125 };
  await expect(provider.tabs.close({ workspaceId: "broken", conversationId: id })).rejects.toMatchObject({ code: "example_session_check_failed" });
  expect(await list("broken")).toHaveLength(1);
`));

test("concurrent provisioning claims launch once, and recovery never resubmits", () => scenario(`
  const context = { agent: { input: { text: "Only once", images: [], attachmentNotes: [] } } };
  await Promise.all([provider.launch.prepareWorkspace("recovery", context), provider.launch.prepareWorkspace("recovery", context)]);
  await createCliAgentModule(adapter).agentProvider.launch.prepareWorkspace("recovery", context);
  expect(calls).toHaveLength(3);
  expect(launches).toHaveLength(1);
  expect(await list("recovery")).toHaveLength(1);
`));

test("providers and workspaces have independent session stores", () => scenario(`
  const other = createCliAgentModule({ ...adapter, id: "other", label: "Other CLI" }).agentProvider;
  const [first, second, third] = await Promise.all([
    provider.create({ workspaceId: "one" }), other.create({ workspaceId: "one" }), provider.create({ workspaceId: "two" }),
  ]);
  expect(new Set([first, second, third]).size).toBe(3);
  expect((await saved("one")).sessions.map(s => s.id)).toEqual([first]);
  expect((await saved("one", "other")).sessions.map(s => s.id)).toEqual([second]);
  expect((await saved("two")).sessions.map(s => s.id)).toEqual([third]);
`));

test("existing Codex placeholders, Claude and Pi sessions retain paths, IDs and tmux names", () => scenario(`
  for (const id of ["codex", "claude", "pi"]) {
    const session = { id: "old-" + id, title: "Existing tab", tmuxSession: id + "-existing", input: { text: "Never submit", images: [], attachmentNotes: [] }, model: "saved-model", thinkingLevel: "high", firstPresentation: true, ...(id !== "codex" ? { kind: id } : {}) };
    const path = process.env.ATELIER_DATA_DIR + "/workspaces/legacy/metadata/" + id + "-agents.json";
    await Bun.write(path, JSON.stringify({ sessions: [session] }));
    const legacy = createCliAgentModule({ ...adapter, id }).agentProvider;
    expect(await legacy.tabs.list({ workspaceId: "legacy" })).toEqual([{ id: session.id, title: session.title }]);
    await legacy.launch.prepareWorkspace("legacy");
    expect(await Bun.file(path).json()).toEqual({ sessions: [session] });
    await legacy.tabs.close({ workspaceId: "legacy", conversationId: session.id });
    expect(calls.at(-1)[1]).toContain(id + "-existing");
  }
  expect(launches).toHaveLength(0);
  expect(preparations).toHaveLength(0);
`));

test("setup errors reject before a session is claimed", () => scenario(`
  setupError = new Error("connect account");
  await expect(provider.create({ workspaceId: "no-auth" })).rejects.toThrow("connect account");
  await expect(provider.launch.prepare({})).rejects.toThrow("connect account");
  await expect(provider.launch.submit(new FormData())).rejects.toThrow("connect account");
  await expect(provider.launch.prepareWorkspace("no-auth")).rejects.toThrow("connect account");
  expect(await list("no-auth")).toEqual([]);
  expect(preparations).toHaveLength(0);
`));

test("launch settings are prepared by the adapter for both form and programmatic launches", () => scenario(`
  const settings = { model: "local::model", serviceTier: "fast" };
  expect(await provider.launch.prepare(settings)).toEqual({ agent: settings });
  const form = new FormData();
  form.set("model", "local::other");
  form.set("level", "high");
  const submitted = await provider.launch.submit(form);
  expect(await submitted.prepare()).toEqual({ agent: { model: "local::other", thinkingLevel: "high" } });
  const minimal = createCliAgentModule({ ...adapter, id: "minimal", prepareWorkspace: undefined }).agentProvider;
  await minimal.create({ workspaceId: "local" });
  expect(preparations).toHaveLength(0);
  expect(launches).toHaveLength(1);
`));

test("starting claims are not ended, and socket admission waits for tmux creation", () => scenario(`
  const { createCliSessions } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/sessions.ts"))});
  const { cliSocketHandler } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/sockets.ts"))});
  const entered = Promise.withResolvers();
  const preparation = Promise.withResolvers();
  const sessions = createCliSessions({ ...adapter, prepareWorkspace: async () => { entered.resolve(); await preparation.promise; } });
  const launch = sessions.create("starting");
  await entered.promise;
  const [claim] = sessions.list("starting");
  expect(await sessions.terminalState("starting", claim)).toEqual({ starting: true, exists: false, ended: false });
  expect(calls).toHaveLength(0);
  let ready = false, admitted = false;
  const readiness = sessions.ready("starting", claim.id).then(session => { ready = true; return session; });
  const socket = cliSocketHandler("example", sessions)(new URL("http://localhost/workspaces/starting/example-agents/" + claim.id + "/ws")).then(connection => { admitted = true; return connection; });
  await Bun.sleep(10);
  expect(ready).toBe(false);
  expect(admitted).toBe(false);
  preparation.resolve();
  expect(await launch).toBe(claim.id);
  expect(await readiness).toBe(claim);
  expect(await socket).toBeDefined();
  expect(calls).toHaveLength(3);
  expect(await sessions.terminalState("starting", claim)).toMatchObject({ exists: true, ended: false });
`));

test("failed startup releases readiness waiters but rejects socket admission", () => scenario(`
  const { createCliSessions } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/sessions.ts"))});
  const { cliSocketHandler } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/sockets.ts"))});
  const entered = Promise.withResolvers();
  const preparation = Promise.withResolvers();
  const sessions = createCliSessions({ ...adapter, prepareWorkspace: async () => { entered.resolve(); await preparation.promise; throw new Error("preparation failed"); } });
  const launch = sessions.create("failed-start");
  await entered.promise;
  const [claim] = sessions.list("failed-start");
  const readiness = sessions.ready("failed-start", claim.id);
  const socket = cliSocketHandler("example", sessions)(new URL("http://localhost/workspaces/failed-start/example-agents/" + claim.id + "/ws"));
  const rejection = socket.then(() => { throw new Error("Socket unexpectedly admitted"); }, error => error);
  preparation.resolve();
  await launch;
  expect((await readiness).error).toBe("preparation failed");
  expect(await rejection).toMatchObject({ code: "agent_session_failed", message: "preparation failed" });
  expect(calls).toHaveLength(0);
`));

test("authenticated turn boundaries identify the exact CLI session and close revokes it", () => scenario(`
  const { createAgentsInTheCloudEventBus } = await import("@agents-in-the-cloud/core");
  const { configureAgentMcp, handleAgentMcpRequest, subscribeWorkspaceAgentBusy } = await import("@agents-in-the-cloud/agent/server");
  const events = createAgentsInTheCloudEventBus();
  const finished = [];
  const busy = [];
  const attention = [];
  module.initialize({ events, registry: { requestAttention(workspaceId) { attention.push(workspaceId); } }, registerSocketHandler() {} });
  events.on("workspace_agent_turn_finished", event => { finished.push(event); });
  subscribeWorkspaceAgentBusy(event => { busy.push(event); });
  configureAgentMcp(events);
  const id = await provider.create({ workspaceId: "completion" });
  const script = calls.find(call => call[2]?.stdin?.includes("Authorization: Bearer"))[2].stdin;
  const token = script.match(/Authorization: Bearer ([\\w.-]+)/)[1];
  const request = (headers = {}, method = "POST", boundary = "finished") => new Request("http://localhost/agent-turn-" + boundary, { method, headers: { authorization: "Bearer " + token, ...headers } });
  expect((await handleAgentMcpRequest(request(), "another-workspace")).status).toBe(401);
  expect((await handleAgentMcpRequest(request({ origin: "http://localhost" }), "completion")).status).toBe(403);
  expect((await handleAgentMcpRequest(request({}, "GET"), "completion")).status).toBe(405);
  expect((await handleAgentMcpRequest(request({ authorization: "Bearer invalid" }), "completion")).status).toBe(401);
  expect(finished).toEqual([]);
  expect(busy).toEqual([]);
  expect(attention).toEqual([]);
  expect((await handleAgentMcpRequest(request({}, "POST", "started"), "completion")).status).toBe(204);
  expect(finished).toEqual([]);
  expect(attention).toEqual([]);
  expect((await handleAgentMcpRequest(request(), "completion")).status).toBe(204);
  expect(busy).toEqual([
    { workspaceId: "completion", agentKey: "agent:" + id, busy: true },
    { workspaceId: "completion", agentKey: "agent:" + id, busy: false },
  ]);
  expect(finished).toEqual([{ workspaceId: "completion", conversationId: id }]);
  expect(attention).toEqual(["completion"]);
  await events.emit("workspace_agent_turn_finished", { workspaceId: "completion", conversationId: "delegated-or-other-provider" });
  await events.emit("workspace_agent_turn_finished", { workspaceId: "another-workspace", conversationId: id });
  expect(attention).toEqual(["completion"]);
  await provider.tabs.close({ workspaceId: "completion", conversationId: id });
  expect((await handleAgentMcpRequest(request({}, "POST", "started"), "completion")).status).toBe(401);
`));

test("startup failure revokes credentials issued before adapter preparation", () => scenario(`
  const { handleAgentMcpRequest } = await import("@agents-in-the-cloud/agent/server");
  let token;
  adapter.prepareSession = async (_workspaceId, _sessionId, mcp) => {
    token = mcp.token;
    throw new Error("session configuration failed");
  };
  const id = await provider.create({ workspaceId: "failed-credentials" });
  expect((await saved("failed-credentials")).sessions[0]).toMatchObject({ id, error: "session configuration failed" });
  expect(launches).toHaveLength(0);
  const request = new Request("http://localhost/agent-turn-finished", { method: "POST", headers: { authorization: "Bearer " + token } });
  expect((await handleAgentMcpRequest(request, "failed-credentials")).status).toBe(401);
`));


test("automatic recovery restores missing processes once without replaying saved input", () => scenario(`
  const { createCliSessions } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/sessions.ts"))});
  const resumed = [];
  const sessions = createCliSessions({ ...adapter, resumeScript: async (...args) => { resumed.push(args); inspectionResult = { ...result, stdout: "0:\\n" }; return "printf resumed"; } }, async () => {});
  const settings = { model: "provider::saved", thinkingLevel: "high", input: { text: "NEVER REPLAY", images: [], attachmentNotes: ["original attachment"] } };
  const id = await sessions.create("restore", settings);
  inspectionResult = { ...result, exitCode: 1 };
  await Promise.all([sessions.restoreWorkspace("restore"), sessions.restoreWorkspace("restore")]);
  expect(resumed).toHaveLength(1);
  expect(resumed[0][0]).toBe("restore");
  expect(resumed[0][1]).toEqual({ model: settings.model, thinkingLevel: settings.thinkingLevel });
  expect(resumed[0][2].id).toBe(id);
  expect(launches).toHaveLength(1);
  expect((await saved("restore")).sessions[0]).toMatchObject({ id, input: settings.input });
`));

test("recovery leaves existing live and dead panes alone", () => scenario(`
  const { createCliSessions } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/sessions.ts"))});
  const sessions = createCliSessions({ ...adapter, resumeScript: async () => { throw new Error("must not resume"); } }, async () => {});
  await sessions.create("existing");
  for (const stdout of ["0:\\n", "1:42\\n"]) {
    inspectionResult = { ...result, stdout };
    await sessions.restoreWorkspace("existing");
  }
  expect((await saved("existing")).sessions[0].error).toBeUndefined();
  expect(launches).toHaveLength(1);
`));

test("one restoration failure preserves its tab and does not block other agents", () => scenario(`
  const { createCliSessions } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/sessions.ts"))});
  const resumed = [];
  const sessions = createCliSessions({ ...adapter, resumeScript: async (_workspaceId, _settings, session) => { resumed.push(session.id); if (resumed.length === 1) throw new Error("native history could not be loaded"); return "printf resumed"; } }, async () => {});
  const first = await sessions.create("failure");
  const second = await sessions.create("failure");
  inspectionResult = { ...result, exitCode: 1 };
  await sessions.restoreWorkspace("failure");
  expect(resumed).toEqual([first, second]);
  expect((await saved("failure")).sessions[0]).toMatchObject({ id: first, error: "native history could not be loaded" });
  expect((await saved("failure")).sessions[1].error).toBeUndefined();
`));
