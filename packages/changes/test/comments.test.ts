import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommentAnchor, locateCommentAnchor, reviewComparisonKey, exportReviewComments, type CommentPlacement } from "../src/comments.ts";
import { CommentConflict, InvalidComment, createReviewCommentStore, placeReviewComments } from "../src/server/comments.ts";
import { parseDiffFromFile } from "@pierre/diffs";
import type { ChangesSnapshot } from "../src/server/snapshot.ts";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function storeDirectory(): string { const directory = mkdtempSync(join(tmpdir(), "review-comments-")); directories.push(directory); return directory; }
function snapshot(contents = "before\nreviewed\nafter\n", label = "Uncommitted changes"): ChangesSnapshot {
  return {
    id: "snapshot", index: { phase: "ready", files: [] }, stats: [],
    files: new Map([["example.ts", { path: "example.ts", change: "modified", kind: "text", newContents: contents, oldContents: "previous\n", diff: parseDiffFromFile({ name: "example.ts", contents: "previous\n" }, { name: "example.ts", contents }) }]]),
    history: { id: "history", commits: [], topology: [], references: [], tips: [], indexTree: "index", emptyTree: "empty", aheadIds: new Set(), endpoints: { target: "working" }, hasStaged: false, hasMore: false, loaded: 0, phase: "ready", head: "head" },
    endpoints: { target: label === "Staged changes" ? "staged" : "working", base: "head" }, base: "head", label, baseLabel: "main", targetLabel: "Working tree",
  };
}
const newComment = { id: "comment", revision: 0, body: "Please change this", path: "example.ts", side: "additions" as const, start: 2, end: 2 };

describe("Review comment anchors", () => {
  test("captures a multiline selection with exact surrounding context", () => {
    const anchor = captureCommentAnchor("a\nb\nc\nd\ne\nf\ng\nh\n", 4, 5);
    expect(anchor).toEqual({ code: ["d", "e"], before: ["a", "b", "c"], after: ["f", "g", "h"] });
    expect(locateCommentAnchor(anchor, "prefix\na\nb\nc\nd\ne\nf\ng\nh\n")).toEqual({ start: 5, end: 6 });
  });
  test("does not relocate edited or ambiguous code, even at the old line number", () => {
    const anchor = captureCommentAnchor("before\nreviewed\nafter\n", 2, 2);
    expect(locateCommentAnchor(anchor, "before\nchanged\nafter\n")).toBeUndefined();
    expect(locateCommentAnchor(anchor, "before\nreviewed\nafter\nbefore\nreviewed\nafter\n")).toBeUndefined();
  });
  test("handles missing trailing newlines and rejects invalid ranges", () => {
    expect(captureCommentAnchor("one\ntwo", 2, 2).code).toEqual(["two"]);
    expect(() => captureCommentAnchor("one\n", 1, 2)).toThrow(RangeError);
    expect(() => captureCommentAnchor("one\n", 0, 1)).toThrow(RangeError);
    expect(() => captureCommentAnchor("one\n", 1.5, 1.5)).toThrow(RangeError);
  });
  test("follows mutable comparisons but distinguishes explicit commit pairs", () => {
    const base = { endpoints: { target: "working", base: "old" }, resolvedBase: "old", head: "old", label: "Uncommitted changes", baseLabel: "main", targetLabel: "Working tree" };
    expect(reviewComparisonKey(base)).toBe(reviewComparisonKey({ ...base, endpoints: { target: "working", base: "new" }, resolvedBase: "new", head: "new" }));
    const explicit = { ...base, endpoints: { target: "commit", base: "old" } };
    expect(reviewComparisonKey(explicit)).not.toBe(reviewComparisonKey({ ...explicit, resolvedBase: "new" }));
    expect(reviewComparisonKey(base)).not.toBe(reviewComparisonKey({ ...base, endpoints: { target: "staged", base: "old" } }));
    expect(reviewComparisonKey({ endpoints: { target: "working" }, resolvedBase: "staged", head: "old" })).toBe("unstaged");
  });
});

describe("Workspace review comment persistence", () => {
  test("survives a fresh store instance and stays isolated per workspace", () => {
    const dataDir = storeDirectory(), store = createReviewCommentStore({ dataDir });
    const comment = store.save("first", newComment, snapshot());
    expect(comment.revision).toBe(1);
    expect(createReviewCommentStore({ dataDir }).list("first")).toEqual([comment]);
    expect(store.list("second")).toEqual([]);
    expect(JSON.parse(readFileSync(join(dataDir, "workspaces/first/metadata/review-comments.json"), "utf8")).comments).toEqual([comment]);
    store.delete("first");
    expect(createReviewCommentStore({ dataDir }).list("first")).toEqual([]);
  });
  test("edits preserve the original anchor and invalidate copy status", () => {
    const store = createReviewCommentStore({ dataDir: storeDirectory() });
    const first = store.save("workspace", newComment, snapshot());
    store.markCopied("workspace", [{ id: first.id, revision: first.revision }]);
    expect(store.list("workspace")[0]!.copiedRevision).toBe(1);
    const edited = store.save("workspace", { id: first.id, revision: 1, body: "Edited review" }, snapshot("different code\n"));
    expect(edited).toMatchObject({ revision: 2, copiedRevision: 1, anchor: first.anchor, body: "Edited review" });
    store.markCopied("workspace", [{ id: first.id, revision: 1 }]);
    expect(store.list("workspace")[0]!.copiedRevision).toBe(1);
    store.markCopied("workspace", [{ id: first.id, revision: 2 }]);
    expect(store.list("workspace")[0]!.copiedRevision).toBe(2);
    expect(store.list("workspace")).toHaveLength(1);
  });
  test("saving an unchanged body does not invalidate the copied revision", () => {
    const store = createReviewCommentStore({ dataDir: storeDirectory() });
    store.save("workspace", newComment, snapshot());
    store.markCopied("workspace", [{ id: "comment", revision: 1 }]);
    expect(store.save("workspace", { id: "comment", revision: 1, body: `  ${newComment.body}  ` }, snapshot())).toMatchObject({ revision: 1, copiedRevision: 1 });
  });
  test("rejects outdated edits and deletes, duplicate creates, and empty bodies", () => {
    const store = createReviewCommentStore({ dataDir: storeDirectory() });
    store.save("workspace", newComment, snapshot());
    store.save("workspace", { id: "comment", revision: 1, body: "new body" }, snapshot());
    expect(() => store.save("workspace", { id: "comment", revision: 1, body: "stale" }, snapshot())).toThrow(CommentConflict);
    expect(() => store.remove("workspace", "comment", 1)).toThrow(CommentConflict);
    expect(() => store.save("workspace", newComment, snapshot())).toThrow(CommentConflict);
    expect(() => store.save("workspace", { ...newComment, id: "empty", body: "  " }, snapshot())).toThrow(InvalidComment);
    store.remove("workspace", "comment", 2);
    store.markCopied("workspace", [{ id: "comment", revision: 2 }]);
    expect(store.list("workspace")).toEqual([]);
    expect(() => store.save("workspace", { id: "comment", revision: 2, body: "deleted" }, snapshot())).toThrow(CommentConflict);
  });
  test("bulk deletion is atomic and rejects stale or missing revisions", () => {
    const dataDir = storeDirectory(), store = createReviewCommentStore({ dataDir });
    const first = store.save("workspace", newComment, snapshot());
    const second = store.save("workspace", { ...newComment, id: "second" }, snapshot());
    const versions = [first, second].map(({ id, revision }) => ({ id, revision }));
    store.save("workspace", { id: second.id, revision: second.revision, body: "Edited in another view" }, snapshot());
    expect(() => store.removeMany("workspace", versions)).toThrow(CommentConflict);
    expect(store.list("workspace")).toHaveLength(2);
    expect(() => store.removeMany("workspace", [{ id: first.id, revision: 1 }, { id: "missing", revision: 1 }])).toThrow(CommentConflict);
    expect(store.list("workspace")).toHaveLength(2);
    store.removeMany("workspace", [{ id: first.id, revision: 1 }, { id: second.id, revision: 2 }]);
    expect(createReviewCommentStore({ dataDir }).list("workspace")).toEqual([]);
  });
  test("bulk deletion preserves comments added after the requested batch and other workspaces", () => {
    const dataDir = storeDirectory(), store = createReviewCommentStore({ dataDir });
    const first = store.save("workspace", newComment, snapshot());
    const versions = [{ id: first.id, revision: first.revision }];
    const later = store.save("workspace", { ...newComment, id: "later" }, snapshot());
    const otherWorkspace = store.save("other", newComment, snapshot());
    store.removeMany("workspace", versions);
    expect(createReviewCommentStore({ dataDir }).list("workspace")).toEqual([later]);
    expect(store.list("other")).toEqual([otherWorkspace]);
  });
  test("retains comments from changed code and other comparisons", () => {
    const store = createReviewCommentStore({ dataDir: storeDirectory() });
    store.save("workspace", newComment, snapshot());
    expect(placeReviewComments(store.list("workspace"), snapshot("prefix\nbefore\nreviewed\nafter\n"))[0]).toMatchObject({ status: "inline", placedStart: 3, placedEnd: 3 });
    expect(placeReviewComments(store.list("workspace"), snapshot("before\nchanged\nafter\n"))[0]!.status).toBe("changed");
    expect(placeReviewComments(store.list("workspace"), snapshot(undefined, "Staged changes"))[0]!.status).toBe("other");
    expect(store.list("workspace")).toHaveLength(1);
  });
  test("exports a code block with filename, source range and a synthesized comment", () => {
    const store = createReviewCommentStore({ dataDir: storeDirectory() });
    store.save("workspace", { ...newComment, start: 5, end: 5, body: "Please change this\nAnd this too" }, snapshot("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n"));
    const comments = placeReviewComments(store.list("workspace"), snapshot());
    expect(exportReviewComments(comments)).toBe("```typescript filename=\"example.ts:3-8\"\nthree\nfour\nfive\n//USER COMMENT: Please change this\n// And this too\nsix\nseven\neight\n```\n");
    expect(exportReviewComments([])).toBe("");
    expect(store.list("workspace")).toHaveLength(1);
  });
  test("exports available context at file boundaries", () => {
    const store = createReviewCommentStore({ dataDir: storeDirectory() });
    store.save("workspace", newComment, snapshot());
    expect(exportReviewComments(placeReviewComments(store.list("workspace"), snapshot()))).toBe("```typescript filename=\"example.ts:1-3\"\nbefore\nreviewed\n//USER COMMENT: Please change this\nafter\n```\n");
  });
  test("preserves a selected range longer than three lines", () => {
    const store = createReviewCommentStore({ dataDir: storeDirectory() });
    store.save("workspace", { ...newComment, start: 2, end: 5 }, snapshot("one\ntwo\nthree\nfour\nfive\nsix\n"));
    expect(exportReviewComments(placeReviewComments(store.list("workspace"), snapshot()))).toContain("filename=\"example.ts:2-6\"\ntwo\nthree\nfour\nfive\n//USER COMMENT: Please change this\nsix");
  });
  test("exports every comment deterministically without comparisons and uses safe fences", () => {
    const store = createReviewCommentStore({ dataDir: storeDirectory() });
    store.save("workspace", { ...newComment, start: 1, end: 2, body: "Keep ``` intact" }, snapshot("```\nreviewed\nafter\n"));
    const comments = placeReviewComments(store.list("workspace"), snapshot("changed\n"));
    const other: CommentPlacement = { ...comments[0]!, id: "other", path: "aaa.ts", status: "other" };
    const exported = exportReviewComments([comments[0]!, other]);
    expect(exported.indexOf('filename="aaa.ts:1-3"')).toBeLessThan(exported.indexOf('filename="example.ts:1-3"'));
    expect(exported).toContain("````typescript filename=\"example.ts:1-3\"\n```\nreviewed\n//USER COMMENT: Keep ``` intact\nafter\n````");
    expect(exported).not.toContain("Comparison:");
    expect(exported).not.toContain("Working tree");
    expect(exported).not.toContain("Code has changed");
    expect(exported).not.toContain("Please address");
  });
  test("uses the file language's comment syntax and a filename fence attribute", () => {
    const store = createReviewCommentStore({ dataDir: storeDirectory() });
    store.save("workspace", newComment, snapshot());
    const original = placeReviewComments(store.list("workspace"), snapshot())[0]!;
    for (const [path, language, annotation] of [
      ["sample.ts", "typescript", "//USER COMMENT: First\n// Second"],
      ["sample.py", "python", "# USER COMMENT: First\n# Second"],
      ["sample.rb", "ruby", "# USER COMMENT: First\n# Second"],
      ["sample.sql", "sql", "-- USER COMMENT: First\n-- Second"],
      ["sample.css", "css", "/* USER COMMENT: First\n * Second */"],
      ["sample.html", "html", "<!-- USER COMMENT: First\nSecond -->"],
      ["sample.xml", "xml", "<!-- USER COMMENT: First\nSecond -->"],
      ["sample.json", "jsonc", "//USER COMMENT: First\n// Second"],
      ["Dockerfile", "docker", "# USER COMMENT: First\n# Second"],
      ["sample.unknown", "text", "//USER COMMENT: First\n// Second"],
    ]) {
      const exported = exportReviewComments([{ ...original, path: path!, body: "First\nSecond" }]);
      expect(exported).toStartWith(`\`\`\`${language} filename="${path}:1-3"\n`);
      expect(exported).toContain(`reviewed\n${annotation}\nafter`);
      expect(exported).not.toContain(`// ${path}:`);
    }
  });
  test("keeps filenames with quotes or backticks out of the code contents", () => {
    const store = createReviewCommentStore({ dataDir: storeDirectory() });
    store.save("workspace", newComment, snapshot());
    const original = placeReviewComments(store.list("workspace"), snapshot())[0]!;
    expect(exportReviewComments([{ ...original, path: 'a "quote".ts' }])).toStartWith('```typescript a "quote".ts:1-3\n');
    expect(exportReviewComments([{ ...original, path: "a`name.ts" }])).toStartWith('~~~typescript filename="a`name.ts:1-3"\n');
  });

});

test("code saves relocate persisted new-side review anchors, preserving old-side and concurrently edited comments", () => {
  const store = createReviewCommentStore({ dataDir: storeDirectory() });
  const before = snapshot();
  const comment = store.save("workspace", newComment, before);
  const old = store.save("workspace", { ...newComment, id: "old", side: "deletions", start: 1, end: 1 }, before);
  store.markCopied("workspace", [{ id: comment.id, revision: 1 }]);
  store.relocate("workspace", before, "example.ts", "prefix\nbefore\nchanged\nafter\n", [{ id: comment.id, revision: 1, start: 3, end: 3 }, { id: old.id, revision: 1, start: 3, end: 3 }]);
  const saved = store.list("workspace").find(entry => entry.id === comment.id)!;
  expect(saved).toMatchObject({ body: comment.body, start: 3, end: 3, revision: 2, copiedRevision: 1 });
  expect(saved.anchor.code).toEqual(["changed"]);
  expect(store.list("workspace").find(entry => entry.id === old.id)).toEqual(old);
  expect(placeReviewComments([saved], snapshot("prefix\nbefore\nchanged\nafter\n"))[0]!.status).toBe("inline");
  store.save("workspace", { id: comment.id, revision: 2, body: "Changed in another tab" }, before);
  const concurrent = store.list("workspace").find(entry => entry.id === comment.id)!;
  store.relocate("workspace", before, "example.ts", "different\n", [{ id: comment.id, revision: 2, start: 1, end: 1 }]);
  expect(store.list("workspace").find(entry => entry.id === comment.id)).toEqual(concurrent);
});
