import { retainedDurableWorkspaceOwner, suspendAllDurableWorkspaceOwners } from "../../src/server/durable-owner.ts";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAtelierEventBus } from "@atelier/core";
import { agentAttachmentDraftId, findStagedAttachment, stageAttachment } from "@atelier/prompt/server";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createRegistry } from "@earendil-works/pi-durable";
import { type DurableAgentRuntime } from "../../src/server/durable-runtime.ts";
import { ensureDefaultWorkspaceAgentConversation } from "../../src/server/session-store.ts";
import { handleAgentRequest } from "../../src/server/routes.ts";
import type { WorkspaceAgentRuntime } from "../../src/server/runtime-types.ts";

let directory: string;
let owner: DurableAgentRuntime | undefined;
const originalDataDir = process.env.ATELIER_DATA_DIR;
afterEach(async () => {
  await suspendAllDurableWorkspaceOwners();
  owner = undefined;
  if (originalDataDir === undefined) delete process.env.ATELIER_DATA_DIR;
  else process.env.ATELIER_DATA_DIR = originalDataDir;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("lost HTTP response retries admitted input after attachment staging is consumed, without preparation or another generation", async () => {
  directory = await mkdtemp(join(tmpdir(), "durable-http-"));
  process.env.ATELIER_DATA_DIR = directory;
  const agent = await ensureDefaultWorkspaceAgentConversation("http-workspace");
  const models = createModels();
  const faux = fauxProvider({ tokensPerSecond: 100_000, models: [{ id: "test", input: ["text", "image"] }] });
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Received the image")]);
  owner = await retainedDurableWorkspaceOwner(agent.path, agent.workspaceId, {}, {
    harness: async () => ({ models, registry: createRegistry() }),
    prepare: async () => ({ model: { provider: "faux", modelId: "test" } }),
    expand: async (_workspace, text) => text,
    ready: async () => {},
  });
  const controller = await owner.conversation(agent);
  const draft = agentAttachmentDraftId(agent.workspaceId, agent.conversationId);
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=", "base64");
  const attachment = await stageAttachment(draft, new File([image], "image.png", { type: "image/png" }));
  let preparations = 0;
  let admissions = 0;
  let accepted: Awaited<ReturnType<typeof controller.submit>>;
  const events = createAtelierEventBus();
  events.on("workspace_agent_prompt_preparing", () => { preparations++; });
  // The route boundary uses an actual native execution controller. No HTML or UI assertions.
  const runtime: Pick<WorkspaceAgentRuntime, "submit" | "userMessages" | "currentModel"> = {
    userMessages: () => [], currentModel: () => undefined,
    async submit(text, options) {
      admissions++;
      accepted = await controller.submit({ text, requestId: options!.requestId!, images: options?.images?.map(image => ({ type: "image", data: image.data, mimeType: image.mimeType })) });
    },
  };
  const request = () => new Request(`http://atelier.test/workspaces/${agent.workspaceId}/agents/${agent.conversationId}/messages`, {
    method: "POST", body: new URLSearchParams({ text: "Look at the image", requestId: "lost-response", attachmentDraft: draft, attachment: attachment.id, reviewComment: "12345678-1234-1234-1234-123456789abc" }),
  });
  const first = request();
  const response = await handleAgentRequest(first, new URL(first.url), {
    events, knownRequest: (_agent, id) => controller.knownRequest(id),
    // SAFETY: This protocol test exercises only the message route's runtime methods above.
    getRuntime: async () => runtime as WorkspaceAgentRuntime,
    suggestTitleFromPrompt: () => {},
  });
  expect(response?.headers.get("x-atelier-attachment-draft-consumed")).toBe("true");
  expect(await findStagedAttachment(draft, attachment.id)).toBeUndefined();
  expect((await accepted!.wait(BACKGROUND_CONTEXT)).status).toBe("done");
  await suspendAllDurableWorkspaceOwners();
  // Reopen the same journal; retry must remain passive, even when execution is unavailable.
  owner = await retainedDurableWorkspaceOwner(agent.path, agent.workspaceId, {}, {
    harness: async () => ({ models, registry: createRegistry() }),
    prepare: async () => { throw new Error("Must not prepare prompts on retry"); },
    expand: async () => { throw new Error("Must not expand on retry"); },
    ready: async () => { throw new Error("Workspace is offline"); },
  });
  const reopened = await owner.conversation(agent);
  const retry = request();
  const retried = await handleAgentRequest(retry, new URL(retry.url), {
    events, knownRequest: (_agent, id) => reopened.knownRequest(id),
    getRuntime: async () => { throw new Error("Must not acquire execution on retry"); },
  });
  expect(retried?.status).toBe(200);
  expect(retried?.headers.get("x-atelier-attachment-draft-consumed")).toBe("true");
  expect(preparations).toBe(1);
  expect(admissions).toBe(1);
  expect(faux.state.callCount).toBe(1);
});
