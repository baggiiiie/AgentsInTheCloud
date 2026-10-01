import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { openDurableWorkspace } from "../../../src/server/durable-workspace.ts";

const [directory, replay] = process.argv.slice(2);
if (!directory || (replay !== "safe" && replay !== "unsafe")) throw new Error("Expected directory and replay policy");
const models = createModels();
const faux = fauxProvider({ tokensPerSecond: 100_000 });
models.setProvider(faux.provider);
faux.setResponses([fauxAssistantMessage([fauxToolCall("effect", {})], { stopReason: "toolUse" })]);
const registry = createRegistry();
registry.install(defineExtension({
  name: "crash-test",
  tools: [defineTool({
    name: "effect",
    description: "Exercise recovery after execution started",
    parameters: Type.Object({}),
    replay,
    async execute(_args, api, context) {
      await appendFile(join(directory, "executions.txt"), "executed\n");
      await api.details({ started: true }, context);
      process.stdout.write("effect-started\n");
      // The parent kills this process without running any shutdown handlers.
      return await new Promise<never>((_resolve, reject) => {
        context.abortSignal!.addEventListener("abort", () => reject(context.abortSignal!.reason), { once: true });
      });
    },
  })],
}));
const workspace = await openDurableWorkspace(directory, "crash-workspace", { models, registry });
const conversation = await workspace.conversation({ conversationId: "crash-tab", label: "Agent 1", title: "Crash recovery" }, {
  model: { provider: "faux", modelId: "faux-1" },
});
await conversation.submit({ type: "input", content: "Run the operation", requestId: "crash-request" }, BACKGROUND_CONTEXT);
// Keep the fixture alive even if the provider has no more active I/O.
setInterval(() => {}, 60_000);
