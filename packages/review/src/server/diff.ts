import { isUtf8 } from "node:buffer";
import { parseDiffFromFile, type FileContents, type FileDiffMetadata } from "@pierre/diffs";
import type { Repository, GitResult, WorkingFile } from "./repository.ts";
export { workspaceRepository, localRepository } from "./repository.ts";
export type { Repository, GitResult } from "./repository.ts";
import type { ReviewSide } from "../model.ts";

const maxRenderedBytes = 1_000_000;
const maxRenderedLines = 5_000;

type ReviewFileKind = "text" | "binary" | "large" | "mode";
type ReviewFileChange = "added" | "modified" | "removed";

export interface ReviewFile {
  path: string;
  previousPath?: string;
  change: ReviewFileChange;
  kind: ReviewFileKind;
  oldContents?: string;
  newContents?: string;
  diff?: FileDiffMetadata;
  detail?: string;
}

export type ReviewFileSummary = {
  path: string;
  previousPath?: string;
  change: ReviewFileChange;
  untracked?: true;
};

export type ReviewFileStats = ReviewFileSummary & ChangeCounts & { binarySizes?: { before?: number; after?: number } };

export type ReviewIndex =
  | { phase: "not-git" }
  | { phase: "ready"; files: ReviewFileSummary[] };

interface StatusEntry {
  code: string;
  path: string;
  previousPath?: string;
}

export async function gitResult(root: Repository, args: string[]): Promise<GitResult> {
  return root.gitResult(args);
}

export async function git(root: Repository, args: string[], allowFailure = false): Promise<Buffer> {
  const result = await gitResult(root, args);
  if (result.exitCode !== 0 && !allowFailure) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.exitCode === 0 ? result.stdout : Buffer.alloc(0);
}

function parseStatus(output: Buffer): StatusEntry[] {
  const fields = output.toString("utf8").split("\0");
  const entries: StatusEntry[] = [];
  for (let index = 0; index < fields.length;) {
    const field = fields[index++];
    if (!field) continue;
    const code = field.slice(0, 2);
    const path = field.slice(3);
    if (code.includes("R") || code.includes("C")) {
      const previousPath = fields[index++];
      const entry: StatusEntry = { code, path };
      if (previousPath) entry.previousPath = previousPath;
      entries.push(entry);
    } else {
      entries.push({ code, path });
    }
  }
  return entries;
}

async function gitObject(root: Repository, path: string): Promise<Buffer | undefined> {
  const result = await gitResult(root, ["show", `HEAD:${path}`]);
  return result.exitCode === 0 ? result.stdout : undefined;
}

async function workingFileEntry(root: Repository, path: string): Promise<WorkingFile | undefined> {
  return root.workingFile(path);
}

async function workingFile(root: Repository, path: string): Promise<Buffer | undefined> {
  return (await workingFileEntry(root, path))?.contents;
}

function decodeText(content: Buffer | undefined): string | undefined {
  if (content === undefined || content.includes(0) || !isUtf8(content)) return undefined;
  return content.toString("utf8");
}

function lineCount(text: string | undefined): number {
  if (!text) return 0;
  return text.split("\n").length;
}

type ChangeCounts = { additions: number; deletions: number };

async function modes(root: Repository, entry: StatusEntry): Promise<{ oldMode?: string; newMode?: string }> {
  const raw = (await git(root, ["diff", "--raw", "HEAD", "--", entry.path], true)).toString("utf8").trim();
  const match = raw.match(/^:(\d{6}) (\d{6}) /);
  if (match) return { oldMode: match[1], newMode: match[2] };
  if (entry.code === "??") {
    return { newMode: (await workingFileEntry(root, entry.path))?.mode };
  }
  return {};
}

function reviewFileFromContents(
  entry: StatusEntry,
  oldBuffer: Buffer | undefined,
  newBuffer: Buffer | undefined,
  noTextDetail: string,
): ReviewFile | undefined {
  const oldPath = entry.previousPath ?? entry.path;
  const change: ReviewFileChange = oldBuffer === undefined ? "added" : newBuffer === undefined ? "removed" : "modified";
  const base: Pick<ReviewFile, "path" | "previousPath" | "change"> = { path: entry.path, change };
  if (entry.previousPath) base.previousPath = entry.previousPath;
  if (oldBuffer === undefined && newBuffer === undefined) return undefined;
  const oldText = decodeText(oldBuffer);
  const newText = decodeText(newBuffer);
  if ((oldBuffer && oldText === undefined) || (newBuffer && newText === undefined)) return { ...base, kind: "binary", detail: "Binary file changed" };
  if ((oldBuffer?.byteLength ?? 0) > maxRenderedBytes || (newBuffer?.byteLength ?? 0) > maxRenderedBytes || lineCount(oldText) > maxRenderedLines || lineCount(newText) > maxRenderedLines) return { ...base, kind: "large", detail: "File is too large to render safely" };
  const oldFile: FileContents | null = oldBuffer === undefined ? null : { name: oldPath, contents: oldText ?? "" };
  const newFile: FileContents | null = newBuffer === undefined ? null : { name: entry.path, contents: newText ?? "" };
  const diff = parseDiffFromFile(oldFile, newFile, { context: 3 });
  return diff.hunks.length
    ? { ...base, kind: "text", oldContents: oldText, newContents: newText, diff }
    : { ...base, kind: "mode", detail: noTextDetail };
}

async function reviewFile(root: Repository, entry: StatusEntry): Promise<ReviewFile | undefined> {
  const oldPath = entry.previousPath ?? entry.path;
  const [oldBuffer, newBuffer, fileModes] = await Promise.all([
    entry.code === "??" ? undefined : gitObject(root, oldPath),
    workingFile(root, entry.path),
    modes(root, entry),
  ]);
  if (oldBuffer === undefined && newBuffer === undefined && (fileModes.oldMode === "160000" || fileModes.newMode === "160000")) {
    const base = { path: entry.path, change: "modified" as const };
    return entry.previousPath ? { ...base, previousPath: entry.previousPath, kind: "mode", detail: "Submodule changed" } : { ...base, kind: "mode", detail: "Submodule changed" };
  }
  const detail = entry.previousPath
    ? "File renamed"
    : oldBuffer === undefined
      ? "Empty file added"
      : newBuffer === undefined
        ? "Empty file deleted"
        : fileModes.oldMode !== fileModes.newMode
          ? "File mode changed"
          : "No textual changes";
  return reviewFileFromContents(entry, oldBuffer, newBuffer, detail);
}

async function statusEntries(root: Repository): Promise<StatusEntry[] | undefined> {
  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"], true);
  if (inside.toString("utf8").trim() !== "true") return undefined;
  return parseStatus(await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
}

function statusChange(entry: StatusEntry): ReviewFileChange {
  if (entry.code === "??" || entry.code.includes("A")) return "added";
  if (entry.code.includes("D")) return "removed";
  return "modified";
}

export async function collectReviewIndex(root: Repository): Promise<ReviewIndex> {
  const entries = await statusEntries(root);
  if (!entries) return { phase: "not-git" };
  const files = entries.map((entry): ReviewFileSummary => {
    const file: ReviewFileSummary = { path: entry.path, change: statusChange(entry) };
    if (entry.previousPath) file.previousPath = entry.previousPath;
    if (entry.code === "??") file.untracked = true;
    return file;
  }).sort((a, b) => a.path.localeCompare(b.path));
  return { phase: "ready", files };
}

export async function collectReviewFile(root: Repository, path: string): Promise<ReviewFile | undefined> {
  const entries = await statusEntries(root);
  const entry = entries?.find((candidate) => candidate.path === path);
  return entry ? await reviewFile(root, entry) : undefined;
}

type Numstat = ChangeCounts & { binary?: true };

function parseNumstat(output: Buffer): Map<string, Numstat> {
  const fields = output.toString("utf8").split("\0");
  const stats = new Map<string, Numstat>();
  for (let index = 0; index < fields.length;) {
    const field = fields[index++];
    if (!field) continue;
    const [additionsValue, deletionsValue, pathValue] = field.split("\t");
    let path = pathValue;
    if (!path) {
      index += 1;
      path = fields[index++]!;
    }
    const counts: Numstat = {
      additions: additionsValue === "-" ? 0 : Number(additionsValue),
      deletions: deletionsValue === "-" ? 0 : Number(deletionsValue),
    };
    if (additionsValue === "-") counts.binary = true;
    stats.set(path, counts);
  }
  return stats;
}

export async function collectReviewStats(root: Repository, index: ReviewIndex): Promise<ReviewFileStats[]> {
  if (index.phase !== "ready") return [];
  let tracked = new Map<string, Numstat>();
  if (index.files.some((file) => !file.untracked)) {
    const head = await git(root, ["rev-parse", "--verify", "HEAD"], true);
    const base = head.byteLength ? "HEAD" : (await git(root, ["hash-object", "-t", "tree", "/dev/null"])).toString("utf8").trim();
    tracked = parseNumstat(await git(root, ["diff", "--numstat", "-z", base, "--"]));
  }
  return Promise.all(index.files.map(async (file) => {
    if (file.untracked) {
      const content = await workingFile(root, file.path);
      const text = decodeText(content);
      if (content !== undefined && text === undefined) {
        return { ...file, additions: 0, deletions: 0, binarySizes: { after: content.byteLength } };
      }
      const additions = text ? lineCount(text) - Number(text.endsWith("\n")) : 0;
      return { ...file, additions, deletions: 0 };
    }
    const { binary, ...counts } = tracked.get(file.path) ?? { additions: 0, deletions: 0 };
    if (binary) {
      const [before, after] = await Promise.all([
        gitObject(root, file.previousPath ?? file.path),
        workingFile(root, file.path),
      ]);
      return { ...file, ...counts, binarySizes: { before: before?.byteLength, after: after?.byteLength } };
    }
    return { ...file, ...counts };
  }));
}

export function reviewSnippet(file: ReviewFile, side: ReviewSide, startLine: number, endLine: number): string {
  const text = side === "additions" ? file.newContents : file.oldContents;
  if (text === undefined) return "";
  return text.split("\n").slice(startLine - 1, endLine).join("\n");
}

interface CommitEntry extends StatusEntry {
  oldMode: string;
  newMode: string;
  oldHash: string;
  newHash: string;
}

async function commitEntries(root: Repository, commit: string): Promise<{ base: string; entries: CommitEntry[] }> {
  const [, parent] = (await git(root, ["rev-list", "--parents", "-n", "1", commit])).toString("utf8").trim().split(" ");
  const base = parent ?? (await git(root, ["hash-object", "-t", "tree", "/dev/null"])).toString("utf8").trim();
  return { base, entries: await comparisonEntries(root, base, commit) };
}

async function comparisonEntries(root: Repository, base: string, end?: string): Promise<CommitEntry[]> {
  const fields = (await git(root, ["diff", "--raw", "--no-abbrev", "-z", "-M", base, ...(end ? [end] : []), "--"])).toString("utf8").split("\0");
  const entries: CommitEntry[] = [];
  for (let index = 0; index < fields.length - 1;) {
    const [oldMode, newMode, oldHash, newHash, code] = fields[index++]!.slice(1).split(" ");
    const path = fields[index++]!;
    const entry: CommitEntry = { code: code!, path, oldMode: oldMode!, newMode: newMode!, oldHash: oldHash!, newHash: newHash! };
    if (code!.startsWith("R") || code!.startsWith("C")) {
      entry.previousPath = path;
      entry.path = fields[index++]!;
    }
    entries.push(entry);
  }
  return entries;
}

export async function collectCommitReviewStats(root: Repository, commit: string): Promise<ReviewFileStats[]> {
  const { base, entries } = await commitEntries(root, commit);
  const stats = parseNumstat(await git(root, ["diff", "--numstat", "-z", "-M", base, commit, "--"]));
  return Promise.all(entries.map(async (entry) => {
    const { binary, ...counts } = stats.get(entry.path)!;
    const file: ReviewFileStats = { path: entry.path, change: statusChange(entry), ...counts };
    if (entry.previousPath) file.previousPath = entry.previousPath;
    if (binary) {
      const size = async (hash: string, mode: string) => mode === "000000" ? undefined : Number((await git(root, ["cat-file", "-s", hash])).toString("utf8"));
      const [before, after] = await Promise.all([size(entry.oldHash, entry.oldMode), size(entry.newHash, entry.newMode)]);
      file.binarySizes = { before, after };
    }
    return file;
  }));
}

/** Compare against the first parent; root commits compare against an empty tree. */
export async function collectCommitReviewFile(root: Repository, commit: string, path: string): Promise<ReviewFile | undefined> {
  const { entries } = await commitEntries(root, commit);
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry) return undefined;
  if (entry.oldMode === "160000" || entry.newMode === "160000") {
    return { path, change: statusChange(entry), kind: "mode", detail: "Submodule changed" };
  }
  const contents = (hash: string, mode: string) => mode === "000000" ? undefined : git(root, ["cat-file", "blob", hash]);
  const [before, after] = await Promise.all([contents(entry.oldHash, entry.oldMode), contents(entry.newHash, entry.newMode)]);
  const detail = entry.previousPath ? "File renamed"
    : before === undefined ? "Empty file added"
    : after === undefined ? "Empty file deleted"
    : entry.oldMode !== entry.newMode ? "File mode changed" : "No textual changes";
  return reviewFileFromContents(entry, before, after, detail);
}

/** Collect a fixed Git comparison, or compare its base with the working tree without touching the index. */
export async function collectReviewComparison(root: Repository, base: string, end?: string): Promise<{ index: ReviewIndex; stats: ReviewFileStats[]; files: Map<string, ReviewFile> }> {
  const entries = await comparisonEntries(root, base, end);
  if (!end) {
    const untracked = (await statusEntries(root))!.filter((entry) => entry.code === "??" && !entries.some((tracked) => tracked.path === entry.path));
    for (const entry of untracked) entries.push({ ...entry, oldMode: "000000", newMode: "100644", oldHash: "", newHash: "" });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const counts = parseNumstat(await git(root, ["diff", "--numstat", "-z", "-M", base, ...(end ? [end] : []), "--"]));
  const files = new Map<string, ReviewFile>();
  const stats: ReviewFileStats[] = new Array(entries.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (cursor < entries.length) {
      const position = cursor++;
      const entry = entries[position]!;
      const summary: ReviewFileSummary = { path: entry.path, change: statusChange(entry) };
      if (entry.previousPath) summary.previousPath = entry.previousPath;
      if (entry.code === "??") summary.untracked = true;
      if (entry.oldMode === "160000" || entry.newMode === "160000") {
        files.set(entry.path, { ...summary, kind: "mode", detail: "Submodule changed" });
        stats[position] = { ...summary, additions: 0, deletions: 0 };
        continue;
      }
      const blob = (hash: string, mode: string) => mode === "000000" ? undefined : git(root, ["cat-file", "blob", hash]);
      const [before, working, committed] = await Promise.all([blob(entry.oldHash, entry.oldMode), end ? undefined : workingFileEntry(root, entry.path), end ? blob(entry.newHash, entry.newMode) : undefined]);
      const after = end ? committed : working?.contents;
      if (working) entry.newMode = working.mode;
      if (!entry.previousPath && before !== undefined && after !== undefined && before.equals(after) && entry.oldMode === entry.newMode) continue;
      const detail = entry.previousPath ? "File renamed" : before === undefined ? "Empty file added" : after === undefined ? "Empty file deleted" : entry.oldMode !== entry.newMode ? "File mode changed" : "No textual changes";
      const file = reviewFileFromContents(entry, before, after, detail);
      if (!file) throw new Error(`File changed while capturing comparison: ${entry.path}`);
      summary.change = file.change;
      files.set(entry.path, file);
      const count = counts.get(entry.path);
      stats[position] = { ...summary, additions: count?.additions ?? (lineCount(decodeText(after)) - Number(decodeText(after)?.endsWith("\n") ?? false)), deletions: count?.deletions ?? 0 };
      if (file.diff) {
        stats[position] = { ...summary, additions: file.diff.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0), deletions: file.diff.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0) };
      }
      if (file.kind === "binary") stats[position] = { ...summary, additions: 0, deletions: 0, binarySizes: { before: before?.byteLength, after: after?.byteLength } };
    }
  }));
  const capturedStats = stats.filter((stat) => stat !== undefined);
  return { index: { phase: "ready", files: capturedStats.map(({ additions: _a, deletions: _d, binarySizes: _b, ...summary }) => summary) }, stats: capturedStats, files };
}
