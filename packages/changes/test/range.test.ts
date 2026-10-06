import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, localRepository } from "@agents-in-the-cloud/review/diff";
import { captureChanges, commitHistory, InvalidChangesRange, workingTree as uncommitted, stagedChanges } from "../src/server/snapshot.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "changes-range-"));
  roots.push(root);
  await git(localRepository(root), ["init", "-b", "main"]);
  await git(localRepository(root), ["config", "user.name", "Changes Test"]);
  await git(localRepository(root), ["config", "user.email", "changes@example.com"]);
  return root;
}
async function commit(root: string, subject: string): Promise<string> {
  await git(localRepository(root), ["add", "."]);
  await git(localRepository(root), ["commit", "--allow-empty", "-m", subject]);
  return (await git(localRepository(root), ["rev-parse", "HEAD"])).toString().trim();
}

test("one commit uses its parent; contiguous ranges use the oldest parent, including the initial commit", async () => {
  const root = await repository();
  await writeFile(join(root, "file.txt"), "one\n");
  const first = await commit(root, "First");
  await writeFile(join(root, "file.txt"), "two\n");
  const second = await commit(root, "Second");
  await writeFile(join(root, "file.txt"), "three\n");
  const third = await commit(root, "Third");
  await writeFile(join(root, "file.txt"), "not committed\n");
  const single = await captureChanges(localRepository(root), { newest: third, oldest: third });
  expect(single.base).toBe(second);
  expect(single.files.get("file.txt")!.oldContents).toBe("two\n");
  expect(single.files.get("file.txt")!.newContents).toBe("three\n");
  const range = await captureChanges(localRepository(root), { newest: third, oldest: second });
  expect(range.base).toBe(first);
  expect(range.files.get("file.txt")!.oldContents).toBe("one\n");
  expect(range.files.get("file.txt")!.newContents).toBe("three\n");
  expect(range.stats[0]!.additions).toBe(1);
  expect(range.stats[0]!.deletions).toBe(1);
  const initial = await captureChanges(localRepository(root), { newest: first, oldest: first });
  expect(initial.files.get("file.txt")!.change).toBe("added");
  expect(initial.files.get("file.txt")!.oldContents).toBeUndefined();
  const all = await captureChanges(localRepository(root), { newest: third, oldest: first });
  expect(all.files.get("file.txt")!.newContents).toBe("three\n");
  expect(all.files.get("file.txt")!.change).toBe("added");
});

test("synthetic endpoint combines committed, staged, unstaged and untracked changes without writing Git", async () => {
  const root = await repository();
  await writeFile(join(root, "file.txt"), "base\n");
  const first = await commit(root, "First");
  await writeFile(join(root, "file.txt"), "committed\n");
  const second = await commit(root, "Second");
  await writeFile(join(root, "file.txt"), "staged\n");
  await git(localRepository(root), ["add", "file.txt"]);
  await writeFile(join(root, "file.txt"), "working\n");
  await writeFile(join(root, "new.txt"), "new\n");
  const status = await git(localRepository(root), ["status", "--porcelain=v1", "-z"]);
  const index = await git(localRepository(root), ["write-tree"]);
  const snapshot = await captureChanges(localRepository(root), { newest: uncommitted, oldest: second });
  expect(snapshot.base).toBe(first);
  expect(snapshot.end).toBeUndefined();
  expect(snapshot.files.get("file.txt")!.oldContents).toBe("base\n");
  expect(snapshot.files.get("file.txt")!.newContents).toBe("working\n");
  expect(snapshot.files.get("new.txt")!.change).toBe("added");
  expect(await git(localRepository(root), ["status", "--porcelain=v1", "-z"])).toEqual(status);
  expect(await git(localRepository(root), ["write-tree"])).toEqual(index);
  expect((await git(localRepository(root), ["rev-parse", "HEAD"])).toString().trim()).toBe(second);
  await writeFile(join(root, "file.txt"), "newer\n");
  const refreshed = await captureChanges(localRepository(root), snapshot.range);
  expect(snapshot.files.get("file.txt")!.newContents).toBe("working\n");
  expect(refreshed.files.get("file.txt")!.newContents).toBe("newer\n");
  expect(refreshed.range).toEqual(snapshot.range);
  expect(refreshed.id).not.toBe(snapshot.id);
});

test("branching history includes side commits and merge comparisons use the first parent", async () => {
  const root = await repository();
  await writeFile(join(root, "main.txt"), "one\n");
  const first = await commit(root, "Initial");
  await git(localRepository(root), ["checkout", "-b", "side"]);
  await writeFile(join(root, "side.txt"), "side\n");
  const side = await commit(root, "Side");
  await git(localRepository(root), ["checkout", "main"]);
  await writeFile(join(root, "main.txt"), "two\n");
  const main = await commit(root, "Main");
  await git(localRepository(root), ["merge", "--no-ff", "side", "-m", "Merge"]);
  const merge = (await git(localRepository(root), ["rev-parse", "HEAD"])).toString().trim();
  const snapshot = await captureChanges(localRepository(root), { newest: merge, oldest: merge });
  expect(snapshot.history.commits.filter(entry => entry.kind === "commit").map(entry => entry.id)).toEqual([merge, side, main, first]);
  expect(snapshot.base).toBe(main);
  expect([...snapshot.files.keys()]).toEqual(["side.txt"]);
  expect((await captureChanges(localRepository(root), { newest: side, oldest: side })).base).toBe(first);
  await expect(captureChanges(localRepository(root), { newest: first, oldest: merge })).rejects.toBeInstanceOf(InvalidChangesRange);
  await expect(captureChanges(localRepository(root), { newest: "HEAD", oldest: "HEAD" })).rejects.toBeInstanceOf(InvalidChangesRange);
});

test("history pages keep topological order and use the captured HEAD even after new commits", async () => {
  const root = await repository();
  const ids = [];
  for (let index = 0; index < 54; index++) ids.unshift(await commit(root, `Entry ${index}`));
  const snapshot = await captureChanges(localRepository(root));
  expect(snapshot.history.commits.filter(entry => entry.kind === "commit")).toHaveLength(8);
  expect(snapshot.history.hasMore).toBe(true);
  await commit(root, "New HEAD");
  const page = await commitHistory(localRepository(root), snapshot.history, 8);
  expect(page.commits.map((entry) => entry.id)).toEqual(ids.slice(8));
  snapshot.history.commits.push(...page.commits);
  expect(page.hasMore).toBe(false);
  const oldest = ids.at(-1)!;
  const selected = await captureChanges(localRepository(root), { newest: oldest, oldest }, snapshot.history);
  expect(selected.range.oldest).toBe(oldest);
  expect(selected.history.commits.at(-1)!.id).toBe(oldest);
});

test("historical ranges handle renames, deletions, binary, large, mode-only and empty files", async () => {
  const root = await repository();
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/old.txt"), "same contents\n");
  await writeFile(join(root, "removed.txt"), "delete\n");
  await writeFile(join(root, "mode.txt"), "same\n");
  await commit(root, "Base");
  await git(localRepository(root), ["mv", "src/old.txt", "src/new.txt"]);
  await rm(join(root, "removed.txt"));
  await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 255]));
  await writeFile(join(root, "large.txt"), "line\n".repeat(5_001));
  await writeFile(join(root, "empty.txt"), "");
  await git(localRepository(root), ["update-index", "--chmod=+x", "mode.txt"]);
  // Commit the staged mode change without resetting it through `git add`.
  await git(localRepository(root), ["add", "src", "removed.txt", "binary.bin", "large.txt", "empty.txt"]);
  await git(localRepository(root), ["commit", "-m", "Special files"]);
  const head = (await git(localRepository(root), ["rev-parse", "HEAD"])).toString().trim();
  const snapshot = await captureChanges(localRepository(root), { newest: head, oldest: head });
  expect(snapshot.files.get("src/new.txt")!.previousPath).toBe("src/old.txt");
  expect(snapshot.files.get("removed.txt")!.change).toBe("removed");
  expect(snapshot.files.get("binary.bin")!.kind).toBe("binary");
  expect(snapshot.stats.find((file) => file.path === "binary.bin")!.binarySizes).toEqual({ before: undefined, after: 3 });
  expect(snapshot.files.get("large.txt")!.kind).toBe("large");
  expect(snapshot.files.get("empty.txt")!.detail).toBe("Empty file added");
  expect(snapshot.files.get("mode.txt")!.detail).toBe("File mode changed");
});

test("working ranges use actual contents when a later deletion is recreated as untracked", async () => {
  const root = await repository();
  await writeFile(join(root, "file.txt"), "base\n");
  await commit(root, "Initial");
  await rm(join(root, "file.txt"));
  const removed = await commit(root, "Delete file");
  await writeFile(join(root, "file.txt"), "recreated\n");
  const snapshot = await captureChanges(localRepository(root), { newest: uncommitted, oldest: removed });
  expect(snapshot.files.get("file.txt")!.change).toBe("modified");
  expect(snapshot.files.get("file.txt")!.oldContents).toBe("base\n");
  expect(snapshot.files.get("file.txt")!.newContents).toBe("recreated\n");
  expect(snapshot.stats[0]!.additions).toBe(1);
  expect(snapshot.stats[0]!.deletions).toBe(1);
  await writeFile(join(root, "file.txt"), "base\n");
  expect((await captureChanges(localRepository(root), snapshot.range)).files.size).toBe(0);
});

test("staged and working nodes compare the captured index independently without changing its bytes", async () => {
  const root = await repository();
  await writeFile(join(root, "file.txt"), "base\n");
  const head = await commit(root, "Base");
  await writeFile(join(root, "file.txt"), "staged\n");
  await git(localRepository(root), ["add", "file.txt"]);
  await writeFile(join(root, "file.txt"), "working\n");
  await writeFile(join(root, "new.txt"), "untracked\n");
  const indexBytes = await readFile(join(root, ".git/index"));
  const all = await captureChanges(localRepository(root));
  expect(all.range).toEqual({ newest: uncommitted, oldest: stagedChanges });
  expect(all.base).toBe(head);
  expect(all.history.commits.slice(0, 3).map(commit => commit.id)).toEqual([uncommitted, stagedChanges, head]);
  const staged = await captureChanges(localRepository(root), { newest: stagedChanges, oldest: stagedChanges }, all.history);
  expect(staged.files.get("file.txt")!.oldContents).toBe("base\n");
  expect(staged.files.get("file.txt")!.newContents).toBe("staged\n");
  expect(staged.files.has("new.txt")).toBe(false);
  const working = await captureChanges(localRepository(root), { newest: uncommitted, oldest: uncommitted }, all.history);
  expect(working.files.get("file.txt")!.oldContents).toBe("staged\n");
  expect(working.files.get("file.txt")!.newContents).toBe("working\n");
  expect(working.files.get("new.txt")!.newContents).toBe("untracked\n");
  expect(await readFile(join(root, ".git/index"))).toEqual(indexBytes);
  // Moving the real index does not change this history's staged endpoint.
  await git(localRepository(root), ["add", "file.txt"]);
  const pinned = await captureChanges(localRepository(root), staged.range, all.history);
  expect(pinned.files.get("file.txt")!.newContents).toBe("staged\n");
  const refreshed = await captureChanges(localRepository(root), staged.range);
  expect(refreshed.files.get("file.txt")!.newContents).toBe("working\n");
});

test("unstaged-only repositories omit the staged node, including unborn HEAD", async () => {
  const root = await repository();
  await writeFile(join(root, "file.txt"), "first\n");
  const unborn = await captureChanges(localRepository(root));
  expect(unborn.history.hasStaged).toBe(false);
  expect(unborn.history.commits.map(commit => commit.id)).toEqual([uncommitted]);
  expect(unborn.files.get("file.txt")!.change).toBe("added");
  await git(localRepository(root), ["add", "."]);
  const staged = await captureChanges(localRepository(root));
  expect(staged.history.hasStaged).toBe(true);
  expect((await captureChanges(localRepository(root), { newest: stagedChanges, oldest: stagedChanges }, staged.history)).files.get("file.txt")!.newContents).toBe("first\n");
  const head = await commit(root, "First");
  await writeFile(join(root, "file.txt"), "second\n");
  const working = await captureChanges(localRepository(root));
  expect(working.history.hasStaged).toBe(false);
  expect(working.history.commits.map(commit => commit.id)).toEqual([uncommitted, head]);
  expect(working.base).toBe(head);
});

test("local branch tips join the graph; remote-only history does not", async () => {
  const root = await repository();
  const first = await commit(root, "Initial");
  await git(localRepository(root), ["checkout", "-b", "side"]);
  await writeFile(join(root, "side.txt"), "side\n");
  const side = await commit(root, "Side");
  await git(localRepository(root), ["checkout", "-b", "remote-only", first]);
  await writeFile(join(root, "remote.txt"), "remote\n");
  const remote = await commit(root, "Remote");
  await git(localRepository(root), ["update-ref", "refs/remotes/origin/remote-only", remote]);
  await git(localRepository(root), ["checkout", "main"]);
  await git(localRepository(root), ["branch", "-D", "remote-only"]);
  const snapshot = await captureChanges(localRepository(root));
  expect(snapshot.history.commits.some(commit => commit.id === side)).toBe(true);
  expect(snapshot.history.commits.some(commit => commit.id === remote)).toBe(false);
  expect(snapshot.history.references.find(ref => ref.name === "origin/remote-only")!.id).toBe(remote);
  const selected = await captureChanges(localRepository(root), { newest: side, oldest: side }, snapshot.history);
  expect(selected.files.get("side.txt")!.newContents).toBe("side\n");
  await expect(captureChanges(localRepository(root), { newest: remote, oldest: remote }, snapshot.history)).rejects.toBeInstanceOf(InvalidChangesRange);
});

test("cross-branch comparisons use the older endpoint's first parent without requiring ancestry", async () => {
  const root = await repository();
  await writeFile(join(root, "file.txt"), "base\n");
  const base = await commit(root, "Base");
  await git(localRepository(root), ["checkout", "-b", "side"]);
  await writeFile(join(root, "file.txt"), "side\n");
  const side = await commit(root, "Side");
  await git(localRepository(root), ["checkout", "main"]);
  await writeFile(join(root, "file.txt"), "main\n");
  const main = await commit(root, "Main");
  const history = (await captureChanges(localRepository(root))).history;
  const endpoints = [main, side].sort((a, b) => history.commits.findIndex(commit => commit.id === a) - history.commits.findIndex(commit => commit.id === b));
  const snapshot = await captureChanges(localRepository(root), { newest: endpoints[0]!, oldest: endpoints[1]! }, history);
  expect(snapshot.base).toBe(base);
  expect(snapshot.end).toBe(endpoints[0]);
  expect(snapshot.files.get("file.txt")!.oldContents).toBe("base\n");
  expect(snapshot.files.get("file.txt")!.newContents).toBe(endpoints[0] === main ? "main\n" : "side\n");
});

test("upstream membership marks only HEAD-reachable commits absent from the actual tracking branch", async () => {
  const root = await repository();
  const base = await commit(root, "Published");
  await git(localRepository(root), ["update-ref", "refs/remotes/origin/main", base]);
  await git(localRepository(root), ["config", "remote.origin.url", "/not-contacted"]);
  await git(localRepository(root), ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
  await git(localRepository(root), ["config", "branch.main.remote", "origin"]);
  await git(localRepository(root), ["config", "branch.main.merge", "refs/heads/main"]);
  const local = await commit(root, "Local");
  await git(localRepository(root), ["checkout", "-b", "side", base]);
  const side = await commit(root, "Side");
  await git(localRepository(root), ["checkout", "main"]);
  const snapshot = await captureChanges(localRepository(root));
  expect(snapshot.history.upstream).toBe("origin/main");
  const records = new Map(snapshot.history.commits.map(commit => [commit.id, commit]));
  expect(records.get(base)!.ahead).toBe(false);
  expect(records.get(local)!.ahead).toBe(true);
  expect(records.get(side)!.ahead).toBe(false);
  // Branch names are labels on pinned object IDs; advancing refs leaves this history fixed.
  await git(localRepository(root), ["update-ref", "refs/remotes/origin/main", local]);
  expect(snapshot.history.upstreamId).toBe(base);
  expect(snapshot.history.references.find(ref => ref.name === "origin/main")!.id).toBe(base);
  expect((await captureChanges(localRepository(root))).history.commits.find(commit => commit.id === local)!.ahead).toBe(false);
});

test("detached HEAD remains reachable and no upstream does not imply unpublished commits", async () => {
  const root = await repository();
  const first = await commit(root, "First");
  await git(localRepository(root), ["checkout", "--detach", first]);
  const detached = await commit(root, "Detached");
  const snapshot = await captureChanges(localRepository(root));
  expect(snapshot.history.head).toBe(detached);
  expect(snapshot.history.branch).toBeUndefined();
  expect(snapshot.history.upstream).toBeUndefined();
  expect(snapshot.history.commits.some(commit => commit.id === detached)).toBe(true);
  expect(snapshot.history.commits.every(commit => !commit.ahead)).toBe(true);
});

test("inclusive range ancestry contains merged side commits, not unrelated local branches", async () => {
  const { comparisonAncestry } = await import("../src/history.ts");
  const root = await repository();
  const base = await commit(root, "Base");
  await git(localRepository(root), ["checkout", "-b", "side"]);
  await writeFile(join(root, "side.txt"), "merged contribution\n");
  const side = await commit(root, "Side contribution");
  await git(localRepository(root), ["checkout", "main"]);
  await writeFile(join(root, "main.txt"), "main\n");
  const main = await commit(root, "Main");
  await git(localRepository(root), ["checkout", "-b", "feature"]);
  await writeFile(join(root, "feature.txt"), "feature\n");
  const feature = await commit(root, "Feature");
  await git(localRepository(root), ["merge", "--no-ff", "side", "-m", "Merge side"]);
  const merge = (await git(localRepository(root), ["rev-parse", "HEAD"])).toString().trim();
  await git(localRepository(root), ["checkout", "-b", "unmerged", main]);
  await writeFile(join(root, "unmerged.txt"), "not in feature\n");
  const unrelated = await commit(root, "Unrelated");
  await git(localRepository(root), ["checkout", "feature"]);
  const snapshot = await captureChanges(localRepository(root), { newest: uncommitted, oldest: main });
  const coverage = comparisonAncestry(snapshot.history.commits, snapshot.range);
  expect(coverage.filter(id => id !== uncommitted).sort()).toEqual([main, feature, merge, side].sort());
  expect(coverage).not.toContain(base);
  expect(coverage).not.toContain(unrelated);
  expect(snapshot.files.get("side.txt")!.newContents).toBe("merged contribution\n");
  expect(snapshot.files.has("unmerged.txt")).toBe(false);
  const actual = (await git(localRepository(root), ["rev-list", merge, "--not", base])).toString().trim().split("\n");
  expect(coverage.filter(id => id !== uncommitted).sort()).toEqual(actual.sort());
});

async function trackingBranch(root: string, id: string): Promise<void> {
  await git(localRepository(root), ["update-ref", "refs/remotes/company/release", id]);
  await git(localRepository(root), ["config", "remote.company.url", "/not-contacted"]);
  await git(localRepository(root), ["config", "remote.company.fetch", "+refs/heads/*:refs/remotes/company/*"]);
  await git(localRepository(root), ["config", "branch.main.remote", "company"]);
  await git(localRepository(root), ["config", "branch.main.merge", "refs/heads/release"]);
}

test("default unpushed comparison includes committed, staged and working changes without loading the full history", async () => {
  const root = await repository();
  await writeFile(join(root, "file.txt"), "published\n");
  const published = await commit(root, "Published");
  await trackingBranch(root, published);
  const ids: string[] = [];
  for (let index = 0; index < 12; index++) {
    await writeFile(join(root, "file.txt"), `local ${index}\n`);
    ids.push(await commit(root, `Local ${index}`));
  }
  await git(localRepository(root), ["checkout", "-b", "unrelated", published]);
  await writeFile(join(root, "unrelated.txt"), "not on main\n");
  const unrelated = await commit(root, "Unrelated");
  await git(localRepository(root), ["checkout", "main"]);
  await writeFile(join(root, "staged.txt"), "staged\n");
  await git(localRepository(root), ["add", "staged.txt"]);
  await writeFile(join(root, "file.txt"), "working\n");
  await writeFile(join(root, "new.txt"), "untracked\n");
  const index = await readFile(join(root, ".git/index"));
  const snapshot = await captureChanges(localRepository(root));
  expect(snapshot.range).toEqual({ newest: uncommitted, oldest: ids[0]!, unpushed: true });
  expect(snapshot.base).toBe(published);
  expect(snapshot.end).toBeUndefined();
  expect(snapshot.history.upstream).toBe("company/release");
  expect(snapshot.history.unpushed?.count).toBe(12);
  expect(snapshot.history.unpushed?.oldest.id).toBe(ids[0]!);
  expect(snapshot.history.aheadIds.has(unrelated)).toBe(false);
  expect(snapshot.history.loaded).toBe(8);
  expect(snapshot.history.hasMore).toBe(true);
  expect(snapshot.history.commits.some(commit => commit.id === ids[0])).toBe(false);
  expect(snapshot.files.get("file.txt")!.oldContents).toBe("published\n");
  expect(snapshot.files.get("file.txt")!.newContents).toBe("working\n");
  expect(snapshot.files.get("staged.txt")!.newContents).toBe("staged\n");
  expect(snapshot.files.get("new.txt")!.newContents).toBe("untracked\n");
  expect(snapshot.files.has("unrelated.txt")).toBe(false);
  expect(await readFile(join(root, ".git/index"))).toEqual(index);
});

test("unpushed defaults exclude tracking-branch changes, while explicit inclusive ranges retain their parent semantics", async () => {
  const root = await repository();
  const base = await commit(root, "Shared base");
  await writeFile(join(root, "ours.txt"), "ours\n");
  const ours = await commit(root, "Local work");
  await git(localRepository(root), ["checkout", "-b", "remote-work", base]);
  await writeFile(join(root, "theirs.txt"), "theirs\n");
  const theirs = await commit(root, "Remote work");
  await git(localRepository(root), ["checkout", "main"]);
  await trackingBranch(root, theirs);
  const diverged = await captureChanges(localRepository(root));
  expect(diverged.base).toBe(base);
  expect(diverged.history.unpushed?.count).toBe(1);
  expect(diverged.files.has("theirs.txt")).toBe(false);
  await git(localRepository(root), ["merge", "--no-ff", "remote-work", "-m", "Merge remote work"]);
  const merged = await captureChanges(localRepository(root));
  expect(merged.range).toEqual({ newest: uncommitted, oldest: ours, unpushed: true });
  expect(merged.base).toBe(theirs);
  expect(merged.history.unpushed?.count).toBe(2);
  expect(merged.files.has("theirs.txt")).toBe(false);
  expect(merged.files.get("ours.txt")!.newContents).toBe("ours\n");
  const explicit = await captureChanges(localRepository(root), { newest: uncommitted, oldest: ours }, merged.history);
  expect(explicit.base).toBe(base);
  expect(explicit.files.has("theirs.txt")).toBe(true);
  await expect(captureChanges(localRepository(root), { newest: uncommitted, oldest: theirs, unpushed: true }, merged.history)).rejects.toBeInstanceOf(InvalidChangesRange);
});

test("published branches and branches without tracking default to uncommitted changes", async () => {
  const root = await repository();
  await writeFile(join(root, "file.txt"), "published\n");
  const head = await commit(root, "Published");
  await trackingBranch(root, head);
  await writeFile(join(root, "file.txt"), "working\n");
  const published = await captureChanges(localRepository(root));
  expect(published.history.unpushed).toBeUndefined();
  expect(published.range).toEqual({ newest: uncommitted, oldest: uncommitted });
  expect(published.base).toBe(head);
  await git(localRepository(root), ["config", "--unset", "branch.main.remote"]);
  await git(localRepository(root), ["config", "--unset", "branch.main.merge"]);
  const untracked = await captureChanges(localRepository(root));
  expect(untracked.history.upstream).toBeUndefined();
  expect(untracked.history.unpushed).toBeUndefined();
  expect(untracked.range).toEqual({ newest: uncommitted, oldest: uncommitted });
});

test("repository read commands disable configured fsmonitor and diff callbacks", async () => {
  const { access, chmod } = await import("node:fs/promises");
  const root = await repository();
  await writeFile(join(root, "file.txt"), "before\n");
  const base = await commit(root, "Base");
  const marker = join(root, "callback-ran");
  const callback = join(root, "callback.sh");
  await writeFile(callback, `#!/bin/sh\nprintf callback > '${marker}'\n`);
  await chmod(callback, 0o755);
  await git(localRepository(root), ["config", "core.fsmonitor", callback]);
  await git(localRepository(root), ["config", "diff.external", callback]);
  await git(localRepository(root), ["config", "diff.attack.command", callback]);
  await git(localRepository(root), ["config", "diff.attack.textconv", callback]);
  await writeFile(join(root, ".gitattributes"), "file.txt diff=attack\n");
  await writeFile(join(root, "file.txt"), "after\n");
  const snapshot = await captureChanges(localRepository(root), { newest: uncommitted, oldest: uncommitted });
  expect(snapshot.base).toBe(base);
  expect(snapshot.files.get("file.txt")!.oldContents).toBe("before\n");
  expect(snapshot.files.get("file.txt")!.newContents).toBe("after\n");
  await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
});

test("range graph follows End ancestry, not the later merge containing both endpoints", async () => {
  const { historyGraph, selectedGraph } = await import("../src/history.ts");
  const root = await repository();
  const start = await commit(root, "Start");
  const fork = await commit(root, "Fork");
  await git(localRepository(root), ["checkout", "-b", "side"]);
  const end = await commit(root, "End on side");
  await git(localRepository(root), ["checkout", "main"]);
  const later = [];
  for (let number = 0; number < 3; number++) later.push(await commit(root, `Later main ${number}`));
  await git(localRepository(root), ["merge", "--no-ff", "side", "-m", "Enclosing merge"]);
  const history = (await captureChanges(localRepository(root))).history;
  const selected = selectedGraph(historyGraph(history.commits), { newest: end, oldest: start });
  expect(selected.path.sort()).toEqual([end, fork, start].sort());
  for (const id of later) {
    expect(selected.path).not.toContain(id);
    // Topological order can put unrelated commits outside the selected span; only inner rows collapse.
    const index = history.commits.findIndex(commit => commit.id === id);
    expect(selected.hidden.has(id)).toBe(index > selected.first && index < selected.last);
  }
});

test("cross-branch comparisons do not draw a forward ancestry trace", async () => {
  const { historyGraph, selectedGraph } = await import("../src/history.ts");
  const root = await repository();
  const base = await commit(root, "Base");
  const start = await commit(root, "Main endpoint");
  await git(localRepository(root), ["checkout", "-b", "side", base]);
  const end = await commit(root, "Side endpoint");
  const history = (await captureChanges(localRepository(root))).history;
  const graph = historyGraph(history.commits);
  expect(selectedGraph(graph, { newest: end, oldest: start }).route).toBe("");
  expect(selectedGraph(graph, { newest: start, oldest: end }).route).toBe("");
  expect(selectedGraph(graph, { newest: end, oldest: base }).route).not.toBe("");
});
