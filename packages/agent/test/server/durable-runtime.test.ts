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
    reopened.resume();
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
