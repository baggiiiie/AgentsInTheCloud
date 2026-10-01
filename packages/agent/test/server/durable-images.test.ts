import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { createDurableReadTool } from "../../src/server/durable-tools.ts";
import { durableEntryContent, durableImageEndpoint } from "../../src/server/durable-images.ts";
import { openDurableWorkspace, type DurableWorkspace } from "../../src/server/durable-workspace.ts";

const context = BACKGROUND_CONTEXT;
// A valid 16×16 red PNG, deliberately larger than the test model's resize profile.
const png = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=";
const paths: string[] = [];
const workspaces: DurableWorkspace[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.close()));
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
  const path = await mkdtemp(join(tmpdir(), "atelier-durable-images-"));
  paths.push(path);
  await writeFile(join(path, "red.png"), Buffer.from(png, "base64"));
  const models = createModels();
  const faux = fauxProvider({ tokensPerSecond: 100_000, models: [
    { id: "small", input: ["text", "image"], inputLimits: { images: { resize: { maxWidth: 4, maxHeight: 4 } } } },
    { id: "text", input: ["text"] },
  ] });
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(defineExtension({ name: "files", tools: [createDurableReadTool(path, models)] }));
  const open = async () => {
    const workspace = await openDurableWorkspace(join(path, "journal"), "images-workspace", { models, registry });
    workspaces.push(workspace);
    return workspace;
  };
  return { path, faux, open, workspace: await open() };
}
const record = { conversationId: "tab", label: "Agent 1", title: "Images" };

test("shared read registry resolves each conversation's model profile and preserves non-vision images", async () => {
  const { workspace, faux, open } = await setup();
  const entries = [];
  for (const modelId of ["small", "text"]) {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { path: "red.png" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Done"),
    ]);
    const conversation = await workspace.conversation({ ...record, conversationId: modelId }, { model: { provider: "faux", modelId } });
    const submission = await conversation.submit({ type: "input", content: "Read the image" }, context);
    expect((await submission.wait(context)).status).toBe("done");
    const result = (await conversation.entries({}, 100, undefined, context)).items.find((entry) => entry.kind === "pi.tool-result")!;
    const image = durableEntryContent(result).find((part) => part.type === "image")!;
    expect(image).toBeDefined();
    const text = durableEntryContent(result).filter((part) => part.type === "text").map((part) => part.text).join("\n");
    if (modelId === "small") {
      expect(text).toContain("4x4");
      expect(image.data).not.toBe(png);
      expect(text).not.toContain("does not support images");
    } else {
      expect(text).toContain("does not support images");
      expect(image.data).toBe(png);
    }
    entries.push({ modelId, result });
  }
  await workspace.close();
  const reopened = await open();
  for (const { modelId, result } of entries) {
    const conversation = await reopened.conversation({ ...record, conversationId: modelId });
    expect((await conversation.entries({ minEntryId: result.id, maxEntryId: result.id }, 1, undefined, context)).items[0]).toEqual(result);
    const imageIndex = durableEntryContent(result).findIndex((part) => part.type === "image");
    const response = await durableImageEndpoint(conversation, String(result.id), imageIndex, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  }
  expect((await reopened.harness.inspect(context)).scheduling).toBe("paused");
});

test("image retrieval is conversation-scoped, fork-aware, passive, and immutable across reopen", async () => {
  const { workspace, open } = await setup();
  const one = await workspace.conversation(record);
  const two = await workspace.conversation({ ...record, conversationId: "another-root" });
  // Commit directly to leave scheduling paused and exercise images from multiple
  // messages in one immutable entry, not just Pi's usual single-message entries.
  const image = await one.commit((tx) => tx.appendEntry(one.id, {
    kind: "test.images", model: [
      { role: "user", content: "Text occupies index zero", timestamp: 1 },
      { role: "user", content: [{ type: "image", mimeType: "image/png", data: png }], timestamp: 2 },
    ],
  }), context);
  const fork = await one.fork(image.id, { ownership: { kind: "ownerless" } }, context);
  const later = await one.commit((tx) => tx.appendEntry(one.id, { kind: "test.images", model: image.model }), context);
  expect((await durableImageEndpoint(two, String(image.id), 1, context)).status).toBe(404);
  expect((await durableImageEndpoint(fork, String(later.id), 1, context)).status).toBe(404);
  expect((await durableImageEndpoint(fork, String(image.id), 1, context)).status).toBe(200);
  for (const id of ["-1", "0", "1.5", "NaN", "9007199254740992", "unknown"]) {
    expect((await durableImageEndpoint(one, id, 1, context)).status).toBe(404);
  }
  for (const index of [-1, 0, 2, 0.5, NaN]) {
    expect((await durableImageEndpoint(one, String(image.id), index, context)).status).toBe(404);
  }
  await workspace.close();
  const reopened = await open();
  const restored = await reopened.conversation(record);
  const response = await durableImageEndpoint(restored, String(image.id), 1, context);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
  expect(response.headers.get("cache-control")).toContain("immutable");
  expect(Buffer.from(await response.arrayBuffer()).toString("base64")).toBe(png);
  expect((await reopened.harness.inspect(context)).scheduling).toBe("paused");
});

test("unsupported image MIME types are not served as active content", async () => {
  const { workspace } = await setup();
  const conversation = await workspace.conversation(record);
  const entry = await conversation.commit((tx) => tx.appendEntry(conversation.id, {
    kind: "test.images", model: [{ role: "user", timestamp: 1, content: [{ type: "image", mimeType: "text/html", data: Buffer.from("<script>alert(1)</script>").toString("base64") }] }],
  }), context);
  expect((await durableImageEndpoint(conversation, String(entry.id), 0, context)).status).toBe(404);
});
