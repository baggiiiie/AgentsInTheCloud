import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import * as files from "@atelier/files/server";
import { createTestApp } from "./support/test-web-app.ts";

const openFiles = spyOn(files, "openFileInFiles");

afterEach(() => openFiles.mockReset());
afterAll(() => openFiles.mockRestore());

test("agent file links open in Files", async () => {
  openFiles.mockResolvedValue(new Response(null, { status: 204 }));
  const { app } = createTestApp();
  const response = await app.fetch(new Request("http://localhost/workspaces/navigation/file/open?path=src/example.ts&line=42&column=3"));
  expect(response.status).toBe(204);
  expect(openFiles).toHaveBeenCalledWith("navigation", { path: "/work/src/example.ts", line: 42, column: 3 }, expect.any(Function));
});

test("neutral file links use Files for paths outside the workspace too", async () => {
  openFiles.mockResolvedValue(new Response(null, { status: 204 }));
  const { app } = createTestApp();
  const response = await app.fetch(new Request("http://localhost/workspaces/navigation/file/open?path=/tmp/example.png"));
  expect(response.status).toBe(204);
  expect(openFiles).toHaveBeenCalledWith("navigation", { path: "/tmp/example.png", line: undefined, column: undefined }, expect.any(Function));
});

test("explicit Files navigation opens in Files", async () => {
  openFiles.mockResolvedValue(new Response(null, { status: 204 }));
  const { app } = createTestApp();
  const response = await app.fetch(new Request("http://localhost/workspaces/navigation/files-view/open?path=/work/example.ts&filesView=workspace"));
  expect(response.ok).toBe(true);
});

test("neutral navigation rejects missing paths and unsupported methods before choosing an editor", async () => {
  const { app } = createTestApp();
  const missing = await app.fetch(new Request("http://localhost/workspaces/navigation/file/open"));
  expect(missing.status).toBe(400);
  const post = await app.fetch(new Request("http://localhost/workspaces/navigation/file/open?path=/work/example.ts", { method: "POST" }));
  expect(post.status).toBe(405);
  expect(post.headers.get("allow")).toBe("GET");
  expect(openFiles).not.toHaveBeenCalled();
});
