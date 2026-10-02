import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { syncWorkspaceDocs } from "../src/server/workspace-docs.ts";

let root: string;
let destination: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "atelier-docs-"));
  destination = join(root, "installed");
  await mkdir(join(root, "docs/deploy-in-workspace"), { recursive: true });
  await mkdir(join(root, "packages/without-docs"), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function source(path: string, content: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

test("deploys shared and package documentation with relative paths and read-only files", async () => {
  await source("docs/deploy-in-workspace/atelier.md", "Shared guide");
  await source("packages/rich-response/deploy-in-workspace/rich-responses.md", "Rich guide");
  await source("packages/example/deploy-in-workspace/examples/usage.md", "Nested guide");
  await syncWorkspaceDocs(root, destination);
  expect(await readFile(join(destination, "atelier.md"), "utf8")).toBe("Shared guide");
  expect(await readFile(join(destination, "rich-responses.md"), "utf8")).toBe("Rich guide");
  expect(await readFile(join(destination, "examples/usage.md"), "utf8")).toBe("Nested guide");
  expect((await stat(join(destination, "rich-responses.md"))).mode & 0o777).toBe(0o444);
});

test("updates and removes docs without replacing mounted directories", async () => {
  await source("packages/example/deploy-in-workspace/examples/usage.md", "First");
  await source("packages/example/deploy-in-workspace/obsolete/old.md", "Old");
  await syncWorkspaceDocs(root, destination);
  const rootInode = (await stat(destination)).ino;
  const nestedInode = (await stat(join(destination, "examples"))).ino;
  await source("packages/example/deploy-in-workspace/examples/usage.md", "Revised");
  await rm(join(root, "packages/example/deploy-in-workspace/obsolete"), { recursive: true });
  await syncWorkspaceDocs(root, destination);
  expect(await readFile(join(destination, "examples/usage.md"), "utf8")).toBe("Revised");
  expect((await stat(destination)).ino).toBe(rootInode);
  expect((await stat(join(destination, "examples"))).ino).toBe(nestedInode);
  expect(await Bun.file(join(destination, "obsolete/old.md")).exists()).toBe(false);
});

test("rejects duplicate destinations before modifying installed docs", async () => {
  await source("docs/deploy-in-workspace/guide.md", "Original");
  await syncWorkspaceDocs(root, destination);
  await source("docs/deploy-in-workspace/guide.md", "Changed");
  await source("packages/example/deploy-in-workspace/guide.md", "Conflicting");
  await expect(syncWorkspaceDocs(root, destination)).rejects.toThrow("Conflicting workspace documentation path: guide.md");
  expect(await readFile(join(destination, "guide.md"), "utf8")).toBe("Original");
});

test("rejects file versus directory collisions", async () => {
  await source("docs/deploy-in-workspace/examples", "A file");
  await source("packages/example/deploy-in-workspace/examples/usage.md", "A directory");
  await expect(syncWorkspaceDocs(root, destination)).rejects.toThrow("Conflicting workspace documentation path: examples");
});
