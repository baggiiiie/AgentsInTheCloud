import { localRepository } from "@agents-in-the-cloud/review/diff";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureChanges } from "../src/server/snapshot.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function git(root: string, ...args: string[]): Promise<void> {
  const process = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const error = await new Response(process.stderr).text();
  if (await process.exited !== 0) throw new Error(error);
}
async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "changes-snapshot-"));
  roots.push(root);
  await git(root, "init");
  await git(root, "config", "user.name", "Changes Test");
  await git(root, "config", "user.email", "changes@example.com");
  return root;
}

test("captures staged, unstaged, untracked, removed and renamed files without changing Git", async () => {
  const root = await repository();
  await mkdir(join(root, "src"));
  for (const name of ["staged", "unstaged", "removed", "renamed"]) await writeFile(join(root, `src/${name}.ts`), `export const ${name} = 1;\n`);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Initial");
  await writeFile(join(root, "src/staged.ts"), "export const staged = 2;\n");
  await git(root, "add", "src/staged.ts");
  await writeFile(join(root, "src/unstaged.ts"), "export const unstaged = 2;\n");
  await writeFile(join(root, "src/new.ts"), "export const added = true;\n");
  await rm(join(root, "src/removed.ts"));
  await git(root, "mv", "src/renamed.ts", "src/moved.ts");
  const snapshot = await captureChanges(localRepository(root));
  expect(snapshot.index.phase).toBe("ready");
  expect([...snapshot.files.keys()].sort()).toEqual(["src/moved.ts", "src/new.ts", "src/removed.ts", "src/staged.ts", "src/unstaged.ts"]);
  expect(snapshot.files.get("src/staged.ts")!.oldContents).toBe("export const staged = 1;\n");
  expect(snapshot.files.get("src/staged.ts")!.newContents).toBe("export const staged = 2;\n");
  expect(snapshot.files.get("src/moved.ts")!.previousPath).toBe("src/renamed.ts");
  expect(snapshot.files.get("src/removed.ts")!.change).toBe("removed");
  for (const file of snapshot.files.values()) if (file.diff) expect(file.diff.cacheKey).toBe(`${snapshot.id}:${file.path}`);
  await writeFile(join(root, "src/unstaged.ts"), "export const unstaged = 3;\n");
  expect(snapshot.files.get("src/unstaged.ts")!.newContents).toBe("export const unstaged = 2;\n");
  const next = await captureChanges(localRepository(root));
  expect(next.id).not.toBe(snapshot.id);
  expect(next.files.get("src/unstaged.ts")!.newContents).toBe("export const unstaged = 3;\n");
});

test("captures binary and oversized files without creating text diffs", async () => {
  const root = await repository();
  await writeFile(join(root, "binary.bin"), Buffer.from([0, 255, 0, 1]));
  await writeFile(join(root, "large.txt"), "line\n".repeat(5_001));
  const snapshot = await captureChanges(localRepository(root));
  expect(snapshot.files.get("binary.bin")!.kind).toBe("binary");
  expect(snapshot.files.get("large.txt")!.kind).toBe("large");
  expect(snapshot.files.get("binary.bin")!.diff).toBeUndefined();
  expect(snapshot.files.get("large.txt")!.diff).toBeUndefined();
});

test("handles clean and non-Git directories", async () => {
  const root = await repository();
  expect((await captureChanges(localRepository(root))).files.size).toBe(0);
  const empty = await mkdtemp(join(tmpdir(), "changes-no-git-"));
  roots.push(empty);
  expect((await captureChanges(localRepository(empty))).index.phase).toBe("not-git");
});
