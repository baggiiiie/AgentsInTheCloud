import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool, type AgentChange } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { openDurableAgentRuntime, type DurableAgentRuntime } from "../../src/server/durable-runtime.ts";
import { durableEntryContent } from "../../src/server/durable-images.ts";

const context = BACKGROUND_CONTEXT;
const paths: string[] = [];
const runtimes: DurableAgentRuntime[] = [];
const record = { conversationId: "tab", label: "Agent 1", title: "Native runtime" };
const png = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=";
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.suspend()));
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const path = await mkdtemp(join(tmpdir(), "atelier-durable-runtime-"));
  paths.push(path);
  const models = createModels();
  const faux = fauxProvider({ tokensPerSecond: 100_000, models: [
    { id: "small", input: ["text", "image"], inputLimits: { images: { resize: { maxWidth: 4, maxHeight: 4 } } } },
    { id: "large", input: ["text", "image"] },
  ] });
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const load = {
    harness: async () => ({ models, registry }),
    prepare: async (): Promise<AgentChange> => ({ model: { provider: "faux", modelId: "small" }, instructions: "Committed instructions", thinkingLevel: "off" }),
    expand: async (_workspace: string, text: string) => text,
    ready: async (_workspace: string) => {},
  };
  const open = async () => {
    const runtime = await openDurableAgentRuntime(path, "native-workspace", {}, load);
    runtimes.push(runtime);
    return runtime;
  };
  return { path, models, faux, registry, load, open, runtime: await open() };
}

test("native runtime owns stable handles and reacquires admission before retry preparation", async () => {
  const { runtime, faux, load, open } = await setup();
  faux.setResponses([fauxAssistantMessage("The original answer")]);
  const [one, same] = await Promise.all([runtime.conversation(record), runtime.conversation(record)]);
  expect(one).toBe(same);
  const first = await one.submit({ requestId: "browser-request", text: "Original input" });
  expect((await first.wait(context)).status).toBe("done");
  await runtime.suspend();
  load.prepare = async () => { throw new Error("Must not reprepare existing conversations"); };
  load.expand = async () => { throw new Error("Must not reprepare admitted requests"); };
  const reopened = await open();
  const restored = await reopened.conversation(record);
  expect(restored.id).toBe(one.id);
  const duplicate = await restored.submit({ requestId: "browser-request", text: "Changed retry" });
  expect(duplicate.id).toBe(first.id);
  expect((await duplicate.wait(context)).status).toBe("done");
  expect(faux.state.callCount).toBe(1);
  const entries = (await restored.history({}, 100, undefined, context)).items;
  expect(JSON.stringify(entries)).toContain("Original input");
  expect(JSON.stringify(entries)).not.toContain("Changed retry");
  await expect(restored.submit({ requestId: "new-request", text: "Fails preparation" })).rejects.toThrow("Must not reprepare admitted requests");
  load.expand = async (_workspace, text) => text;
  faux.setResponses([fauxAssistantMessage("A later command still works")]);
  const corrected = await restored.submit({ requestId: "new-request", text: "Corrected" });
  expect((await corrected.wait(context)).status).toBe("done");
});

test("settings serialize with image preparation without blocking another conversation", async () => {
  const { runtime, faux, load } = await setup();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  load.expand = async (_workspace, text) => {
    if (text === "Hold preparation") { entered.resolve(); await release.promise; }
    return text;
  };
  faux.setResponses([fauxAssistantMessage("Independent"), fauxAssistantMessage("Prepared")]);
  const one = await runtime.conversation(record);
  const two = await runtime.conversation({ ...record, conversationId: "other" });
  const admitted = one.submit({ requestId: "slow", text: "Hold preparation", images: [{ type: "image", data: png, mimeType: "image/png" }] });
  await entered.promise;
  const configure = one.configure({ model: { provider: "faux", modelId: "large" } });
  const independent = await two.submit({ requestId: "slow", text: "Independent root" });
  expect((await independent.wait(context)).status).toBe("done");
  expect((await one.agent(context)).model?.modelId).toBe("small");
  release.resolve();
  const submission = await admitted;
  await configure;
  expect((await submission.wait(context)).status).toBe("done");
  const user = (await one.history({}, 100, undefined, context)).items.find((entry) => entry.model?.some((message) => message.role === "user"))!;
  expect(JSON.stringify(durableEntryContent(user))).toContain("4x4");
  expect((await one.agent(context)).model?.modelId).toBe("large");
  expect((await two.agent(context)).model?.modelId).toBe("small");
  await expect(one.configure({ model: { provider: "faux", modelId: "missing" } })).rejects.toThrow("Model not found");
  expect((await one.agent(context)).model?.modelId).toBe("large");
});

test.each(["suspend", "stop"] as const)("native %s preserves or withdraws committed steering, and passive reopen does not run it", async (operation) => {
  const { runtime, faux, registry, open } = await setup();
  const started = Promise.withResolvers<void>();
  registry.install(defineExtension({ name: "blocking", tools: [defineTool({
    name: "block", description: "Wait until interrupted", parameters: Type.Object({}),
    async execute(_args, _api, invocation) {
      started.resolve();
      return new Promise<never>((_resolve, reject) => {
        invocation.abortSignal!.addEventListener("abort", () => reject(invocation.abortSignal!.reason), { once: true });
      });
    },
  })] }));
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("block", {})], { stopReason: "toolUse" }),
    (request) => {
      expect(JSON.stringify(request)).toContain("Queued instruction");
      expect(JSON.stringify(request)).not.toContain("Atelier restarted");
      return fauxAssistantMessage("Recovered");
    },
  ]);
  const agent = await runtime.conversation(record);
  const initial = await agent.submit({ requestId: "initial", text: "Begin" });
  await started.promise;
  const steer = await agent.submit({ requestId: "steer", text: "Queued instruction" });
  expect((await steer.status(context)).status).toBe("queued");
  await expect(agent.reset()).rejects.toThrow("Stop the agent");
  if (operation === "stop") await agent.stop();
  await runtime.suspend();
  await expect(agent.submit({ requestId: "after-suspend", text: "No admission" })).rejects.toThrow("suspended");
  const reopened = await open();
  const restored = await reopened.conversation(record);
  const watch = await restored.watch(context);
  expect(Boolean(watch.value.docs["pi.live"]?.run)).toBe(operation === "suspend");
  const duplicate = await restored.submit({ requestId: "steer", text: "Retry" });
  expect(duplicate.id).toBe(steer.id);
  expect((await duplicate.status(context)).status).toBe(operation === "suspend" ? "queued" : "unanswered");
  expect(faux.state.callCount).toBe(1);
  if (operation === "suspend") {
    await reopened.resume();
    expect((await duplicate.wait(context)).status).toBe("done");
    expect(faux.state.callCount).toBe(2);
  } else {
    const prior = await restored.submit({ requestId: "initial", text: "Retry" });
    expect(prior.id).toBe(initial.id);
    expect((await prior.status(context)).status).toBe("unanswered");
  }
  await watch.stop();
});

test("reset changes active context but retains journal history and settings", async () => {
  const { runtime, faux, open } = await setup();
  faux.setResponses([fauxAssistantMessage("Old answer")]);
  const agent = await runtime.conversation(record);
  const submission = await agent.submit({ requestId: "old", text: "Old input" });
  await submission.wait(context);
  await agent.reset();
  const active = await agent.context(context);
  expect(JSON.stringify(active.messages)).not.toContain("Old input");
  expect(JSON.stringify((await agent.history({}, 100, undefined, context)).items)).toContain("Old input");
  expect((await agent.agent(context)).model?.modelId).toBe("small");
  await runtime.suspend();
  const reopened = await open();
  const restored = await reopened.conversation(record);
  expect(JSON.stringify((await restored.context(context)).messages)).not.toContain("Old input");
  expect((await restored.agent(context)).instructions).toBe("Committed instructions");
});

test("committed watches reconnect with complete state; disconnecting a viewer does not stop work", async () => {
  const { runtime, faux, registry } = await setup();
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  registry.install(defineExtension({ name: "progress", tools: [defineTool({
    name: "progress", description: "Publish progress and wait", parameters: Type.Object({}),
    async execute(_args, api) {
      api.output("Committed output");
      started.resolve();
      await finish.promise;
      return { content: [{ type: "text", text: "Completed output" }] };
    },
  })] }));
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("progress", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("Finished"),
  ]);
  const agent = await runtime.conversation(record);
  const viewer = await agent.watch(context);
  const sawRun = Promise.withResolvers<void>();
  viewer.start(async (value) => { if (value.docs["pi.live"]?.run) sawRun.resolve(); });
  const admitted = await agent.submit({ requestId: "watched", text: "Watch committed state" });
  await sawRun.promise;
  await started.promise;
  await viewer.stop();
  expect((await admitted.status(context)).status).toBe("placed");
  const reconnect = await agent.watch(context);
  expect(reconnect.value.docs["pi.live"]?.run).toBeDefined();
  expect(JSON.stringify(reconnect.value.docs["pi.live"])).toContain("progress");
  finish.resolve();
  await admitted.wait(context);
  await reconnect.stop();
  const settled = await agent.watch(context);
  expect(settled.value.docs["pi.live"]?.run).toBeUndefined();
  expect(JSON.stringify(settled.value.entries)).toContain("Completed output");
  expect(JSON.stringify(settled.value.entries)).toContain("Finished");
  await settled.stop();
});

test("suspending during preparation fences pending admission without adding a recovery prompt", async () => {
  const { runtime, faux, load, open } = await setup();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  load.expand = async (_workspace, text) => { entered.resolve(); await release.promise; return text; };
  const agent = await runtime.conversation(record);
  const pending = agent.submit({ requestId: "preparing", text: "Not yet admitted" });
  await entered.promise;
  await runtime.suspend();
  release.resolve();
  await expect(pending).rejects.toThrow("suspended");
  const reopened = await open();
  const restored = await reopened.conversation(record);
  expect((await restored.history({}, 100, undefined, context)).items).toHaveLength(0);
  expect(faux.state.callCount).toBe(0);
});

test.each(["close", "delete"] as const)("permanent %s fences preparation and survives reopen with readable history", async (operation) => {
  const { runtime, faux, load, open } = await setup();
  faux.setResponses([fauxAssistantMessage("Saved answer"), fauxAssistantMessage("Other root")]);
  const agent = await runtime.conversation(record);
  await (await agent.submit({ requestId: "saved", text: "Saved input" })).wait(context);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  load.expand = async (_workspace, text) => { entered.resolve(); await release.promise; return text; };
  const pending = agent.submit({ requestId: "blocked", text: "Not admitted" });
  await entered.promise;
  const closing = operation === "close" ? agent.close() : runtime.delete();
  release.resolve();
  await expect(pending).rejects.toThrow(operation === "close" ? "closed" : "deleted");
  await closing;
  await expect(agent.configure({ thinkingLevel: "off" })).rejects.toThrow(operation === "close" ? "closed" : "deleted");
  await runtime.suspend();
  const reopened = await open();
  const restored = await reopened.conversation(record);
  expect(JSON.stringify((await restored.history({}, 100, undefined, context)).items)).toContain("Saved input");
  await expect(restored.submit({ requestId: "saved", text: "Even retries cannot start work" })).rejects.toThrow(operation === "close" ? "closed" : "deleted");
  if (operation === "delete") {
    await expect(reopened.conversation({ ...record, conversationId: "new" })).rejects.toThrow("deleted");
  } else {
    load.expand = async (_workspace, text) => text;
    const other = await reopened.conversation({ ...record, conversationId: "new" });
    await (await other.submit({ requestId: "other", text: "Independent" })).wait(context);
  }
  expect(faux.state.callCount).toBe(operation === "close" ? 2 : 1);
});

test.each(["close", "delete"] as const)("recovery after %s gate commit marks work before any scheduler resume", async (operation) => {
  const { runtime, path, faux, load, registry, open } = await setup();
  const { openDurableWorkspace } = await import("../../src/server/durable-workspace.ts");
  const { WorkspaceAdmission } = await import("../../src/server/durable-lifecycle.ts");
  const started = Promise.withResolvers<void>();
  let executions = 0;
  registry.install(defineExtension({ name: "replay-probe", tools: [defineTool({
    name: "probe", description: "Safe execution must not recover after close", parameters: Type.Object({}),
    replay: "safe",
    async execute(_args, _api, invocation) {
      executions++;
      started.resolve();
      return new Promise<never>((_resolve, reject) => {
        invocation.abortSignal!.addEventListener("abort", () => reject(invocation.abortSignal!.reason), { once: true });
      });
    },
  })] }));
  faux.setResponses([fauxAssistantMessage([fauxToolCall("probe", {})], { stopReason: "toolUse" })]);
  const agent = await runtime.conversation(record);
  await agent.submit({ requestId: "run", text: "Start tool" });
  await started.promise;
  await agent.submit({ requestId: "queued", text: "Must not execute" });
  await runtime.suspend();
  // Simulate the durable boundary: host died after committing the gate and
  // before withdrawing inputs or cancelling tasks. No destructive UI fixture.
  const workspace = await openDurableWorkspace(path, "native-workspace", await load.harness());
  await workspace.harness.commit(async (tx) => {
    const admission = await tx.doc(WorkspaceAdmission);
    if (operation === "delete") admission.deleted = true;
    else admission.closed.push(agent.id);
  }, context);
  await workspace.close();
  const reopened = await open();
  const restored = await reopened.conversation(record);
  const watch = await restored.watch(context);
  const idle = Promise.withResolvers<void>();
  watch.start(async (value) => { if (!value.docs["pi.live"]?.run) idle.resolve(); });
  expect(executions).toBe(1);
  expect(faux.state.callCount).toBe(1);
  await reopened.resume();
  await idle.promise;
  await watch.stop();
  expect(executions).toBe(1);
  expect(faux.state.callCount).toBe(1);
  expect(JSON.stringify((await restored.history({}, 100, undefined, context)).items)).not.toContain("Must not execute");
});

test.each(["close", "delete"] as const)("live %s cancels work and withdraws queued input before resolving", async (operation) => {
  const { runtime, faux, registry } = await setup();
  const started = Promise.withResolvers<void>();
  let interrupted = false;
  registry.install(defineExtension({ name: "live-close", tools: [defineTool({
    name: "hold", description: "Wait for cancellation", parameters: Type.Object({}),
    async execute(_args, _api, invocation) {
      started.resolve();
      return new Promise<never>((_resolve, reject) => {
        invocation.abortSignal!.addEventListener("abort", () => {
          interrupted = true;
          reject(invocation.abortSignal!.reason);
        }, { once: true });
      });
    },
  })] }));
  faux.setResponses([fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" })]);
  const agent = await runtime.conversation(record);
  const first = await agent.submit({ requestId: "first", text: "Begin" });
  await started.promise;
  const queued = await agent.submit({ requestId: "queued", text: "Never run" });
  if (operation === "close") await agent.close();
  else await runtime.delete();
  expect(interrupted).toBe(true);
  expect((await first.status(context)).status).toBe("unanswered");
  expect((await queued.status(context)).status).toBe("unanswered");
  const watch = await agent.watch(context);
  expect(watch.value.docs["pi.live"]?.run).toBeUndefined();
  await watch.stop();
  expect(faux.state.callCount).toBe(1);
});

test("committed titles survive stale attachment metadata and remain discoverable after close and deletion", async () => {
  const { runtime, faux, load, open } = await setup();
  expect(await runtime.catalog()).toEqual([]);
  const one = await runtime.conversation(record);
  const otherRecord = { ...record, conversationId: "other", title: "Independent title" };
  const two = await runtime.conversation(otherRecord);
  const renamed = await one.setTitle("searchable-durable-title");
  expect(renamed).toEqual({ ...record, durableId: one.id, title: "searchable-durable-title" });
  expect(await runtime.catalog()).toEqual([renamed, { ...otherRecord, durableId: two.id }]);
  await runtime.suspend();
  load.prepare = async () => { throw new Error("Catalog reads must not prepare prompts"); };
  const reopened = await open();
  expect((await reopened.catalog())[0]).toEqual(renamed);
  const restored = await reopened.conversation(record);
  expect((await reopened.catalog())[0]?.title).toBe("searchable-durable-title");
  await restored.close();
  await expect(restored.setTitle("Closed rename")).rejects.toThrow("closed");
  expect((await reopened.catalog())[0]).toEqual(renamed);
  await reopened.delete();
  const retained = await reopened.catalog();
  expect(retained).toHaveLength(2);
  expect(retained[0]).toEqual(renamed);
  expect(faux.state.callCount).toBe(0);
  await reopened.suspend();
  expect(await (await open()).catalog()).toEqual(retained);
});

test("title changes serialize with commands and cannot cross a close fence", async () => {
  const { runtime, load } = await setup();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  load.expand = async (_workspace, text) => { entered.resolve(); await release.promise; return text; };
  const agent = await runtime.conversation(record);
  const pending = agent.submit({ requestId: "blocked", text: "Waiting" });
  await entered.promise;
  const title = agent.setTitle("Must not commit");
  const close = agent.close();
  release.resolve();
  await expect(pending).rejects.toThrow("closed");
  await expect(title).rejects.toThrow("closed");
  await close;
  expect((await runtime.catalog())[0]?.title).toBe(record.title);
});

test("reopened reads and known requests stay passive; new execution waits for workspace readiness", async () => {
  const { runtime, faux, load, open } = await setup();
  faux.setResponses([fauxAssistantMessage("Saved"), fauxAssistantMessage("New")]);
  const agent = await runtime.conversation(record);
  const saved = await agent.submit({ requestId: "saved", text: "Original" });
  await saved.wait(context);
  await runtime.suspend();
  const entered = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  let probes = 0;
  load.ready = async () => { probes++; entered.resolve(); await ready.promise; };
  const reopened = await open();
  const restored = await reopened.conversation(record);
  await reopened.catalog();
  await restored.history({}, 100, undefined, context);
  const watch = await restored.watch(context);
  await watch.stop();
  expect((await restored.submit({ requestId: "saved", text: "Retry" })).id).toBe(saved.id);
  expect(probes).toBe(0);
  const pending = restored.submit({ requestId: "new", text: "New input" });
  await entered.promise;
  expect(faux.state.callCount).toBe(1);
  expect(JSON.stringify((await restored.history({}, 100, undefined, context)).items)).not.toContain("New input");
  ready.resolve();
  await (await pending).wait(context);
  expect(probes).toBe(1);
  expect(faux.state.callCount).toBe(2);
});

test("readiness failure rejects before prompt preparation and admission, and a later command can retry", async () => {
  const { runtime, faux, load } = await setup();
  load.ready = async () => { throw new Error("Workspace offline"); };
  await expect(runtime.conversation(record)).rejects.toThrow("Workspace offline");
  expect(await runtime.catalog()).toEqual([]);
  load.ready = async () => {};
  const agent = await runtime.conversation(record);
  load.ready = async () => { throw new Error("Workspace offline again"); };
  await expect(agent.submit({ requestId: "retryable", text: "Not admitted" })).rejects.toThrow("Workspace offline again");
  await expect(agent.compact()).rejects.toThrow("Workspace offline again");
  await expect(runtime.resume()).rejects.toThrow("Workspace offline again");
  expect((await agent.history({}, 100, undefined, context)).items).toHaveLength(0);
  expect(faux.state.callCount).toBe(0);
  load.ready = async () => {};
  faux.setResponses([fauxAssistantMessage("Recovered")]);
  await (await agent.submit({ requestId: "retryable", text: "Now admitted" })).wait(context);
  expect(faux.state.callCount).toBe(1);
});

test.each(["suspend", "close", "delete"] as const)("%s during readiness prevents late admission", async (operation) => {
  const { runtime, faux, load } = await setup();
  const agent = await runtime.conversation(record);
  const entered = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  load.ready = async () => { entered.resolve(); await ready.promise; };
  const pending = agent.submit({ requestId: "late", text: "Must not run" });
  await entered.promise;
  const ending = operation === "close" ? agent.close() : operation === "delete" ? runtime.delete() : runtime.suspend();
  ready.resolve();
  await expect(pending).rejects.toThrow(operation === "suspend" ? "suspended" : operation === "close" ? "closed" : "deleted");
  await ending;
  expect(faux.state.callCount).toBe(0);
});

test("recovery cannot replay a tool until the execution workspace is ready", async () => {
  const { runtime, faux, load, registry, open } = await setup();
  const started = Promise.withResolvers<void>();
  let executions = 0;
  registry.install(defineExtension({ name: "ready-probe", tools: [defineTool({
    name: "probe", description: "Replay only after readiness", parameters: Type.Object({}), replay: "safe",
    async execute(_args, _api, invocation) {
      executions++;
      if (executions > 1) return { content: [{ type: "text", text: "Recovered tool" }] };
      started.resolve();
      return new Promise<never>((_resolve, reject) => {
        invocation.abortSignal!.addEventListener("abort", () => reject(invocation.abortSignal!.reason), { once: true });
      });
    },
  })] }));
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("probe", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("Recovered answer"),
  ]);
  const agent = await runtime.conversation(record);
  await agent.submit({ requestId: "recover", text: "Begin" });
  await started.promise;
  await runtime.suspend();
  const entered = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  load.ready = async () => { entered.resolve(); await ready.promise; };
  const reopened = await open();
  const restored = await reopened.conversation(record);
  const recovery = reopened.resume();
  await entered.promise;
  expect(executions).toBe(1);
  expect(faux.state.callCount).toBe(1);
  ready.resolve();
  await recovery;
  await (await restored.submit({ requestId: "recover", text: "Retry" })).wait(context);
  expect(executions).toBe(2);
  expect(faux.state.callCount).toBe(2);
});

test.each(["close", "delete"] as const)("%s persists its fence even if cleanup readiness fails, and cleanup can be retried", async (operation) => {
  const { runtime, faux, load, registry, open } = await setup();
  const started = Promise.withResolvers<void>();
  let executions = 0;
  registry.install(defineExtension({ name: "offline-close", tools: [defineTool({
    name: "hold", description: "Must never replay", parameters: Type.Object({}), replay: "safe",
    async execute(_args, _api, invocation) {
      executions++;
      started.resolve();
      return new Promise<never>((_resolve, reject) => {
        invocation.abortSignal!.addEventListener("abort", () => reject(invocation.abortSignal!.reason), { once: true });
      });
    },
  })] }));
  faux.setResponses([fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" })]);
  const agent = await runtime.conversation(record);
  await agent.submit({ requestId: "offline", text: "Begin" });
  await started.promise;
  await runtime.suspend();
  load.ready = async () => { throw new Error("Cleanup workspace offline"); };
  const reopened = await open();
  const restored = await reopened.conversation(record);
  await expect(operation === "close" ? restored.close() : reopened.delete()).rejects.toThrow("Cleanup workspace offline");
  await expect(restored.submit({ requestId: "offline", text: "Retry" })).rejects.toThrow(operation === "close" ? "closed" : "deleted");
  load.ready = async () => {};
  await (operation === "close" ? restored.close() : reopened.delete());
  expect(executions).toBe(1);
  expect(faux.state.callCount).toBe(1);
  await reopened.suspend();
  const retained = await (await open()).conversation(record);
  await expect(retained.setTitle("Cannot reopen")).rejects.toThrow(operation === "close" ? "closed" : "deleted");
});

test("resetting an idle root cannot recover another root before readiness", async () => {
  const { runtime, faux, load, registry, open } = await setup();
  const started = Promise.withResolvers<void>();
  let executions = 0;
  registry.install(defineExtension({ name: "reset-ready", tools: [defineTool({
    name: "probe", description: "Replay after readiness", parameters: Type.Object({}), replay: "safe",
    async execute(_args, _api, invocation) {
      executions++;
      if (executions > 1) return { content: [{ type: "text", text: "Recovered" }] };
      started.resolve();
      return new Promise<never>((_resolve, reject) => {
        invocation.abortSignal!.addEventListener("abort", () => reject(invocation.abortSignal!.reason), { once: true });
      });
    },
  })] }));
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("probe", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("Finished"),
  ]);
  const busy = await runtime.conversation(record);
  const idleRecord = { ...record, conversationId: "idle" };
  await runtime.conversation(idleRecord);
  await busy.submit({ requestId: "recover", text: "Begin" });
  await started.promise;
  await runtime.suspend();
  const reopened = await open();
  const idle = await reopened.conversation(idleRecord);
  load.ready = async () => { throw new Error("Workspace offline"); };
  await expect(idle.reset()).rejects.toThrow("Workspace offline");
  expect(executions).toBe(1);
  const entered = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  load.ready = async () => { entered.resolve(); await ready.promise; };
  const resetting = idle.reset();
  await entered.promise;
  expect(executions).toBe(1);
  expect(faux.state.callCount).toBe(1);
  ready.resolve();
  await resetting;
  const restored = await reopened.conversation(record);
  await (await restored.submit({ requestId: "recover", text: "Retry" })).wait(context);
  expect(executions).toBe(2);
});
