import { collectReviewComparison, collectReviewIndex, git, type ReviewFile, type ReviewFileStats, type ReviewIndex, type Repository } from "@agents-in-the-cloud/review/diff";
import { ancestryPath, endpointName, isUnpushedRange, rangeDescription, stagedChanges, workingTree, type ChangesCommit, type ChangesRange, type ChangesRef, type HistoryModel } from "../history.ts";
export { stagedChanges, workingTree } from "../history.ts";
export type { ChangesCommit, ChangesRange } from "../history.ts";

export interface ChangesHistory extends HistoryModel {
  id: string;
  tips: string[];
  indexTree: string;
  emptyTree: string;
  upstreamId?: string;
  references: (ChangesRef & { id: string })[];
  aheadIds: Set<string>;
  hasMore: boolean;
  loaded: number;
  phase: ReviewIndex["phase"];
}
export interface ChangesSnapshot {
  id: string;
  index: ReviewIndex;
  stats: ReviewFileStats[];
  files: Map<string, ReviewFile>;
  history: ChangesHistory;
  range: ChangesRange;
  label: string;
  base?: string;
  baseLabel: string;
  end?: string;
  endLabel: string;
}
export class InvalidChangesRange extends Error {}

const commitFormat = "%H%x00%P%x00%s%x00%an%x00%cs";
function commitRecord(history: ChangesHistory, line: string): ChangesCommit {
  const [id, parents, subject, author, date] = line.split("\0");
  return { id: id!, parents: parents ? parents.split(" ") : [], subject: subject!, author: author!, date: date!, refs: history.references.filter(ref => ref.id === id), ahead: history.aheadIds.has(id!), kind: "commit" };
}

export async function commitHistory(root: Repository, history: ChangesHistory, skip = 0, limit = 50): Promise<{ commits: ChangesCommit[]; hasMore: boolean }> {
  if (!history.tips.length) return { commits: [], hasMore: false };
  const output = (await git(root, ["log", "--topo-order", `--skip=${skip}`, `--max-count=${limit + 1}`, `--format=${commitFormat}`, ...history.tips, "--"])).toString("utf8").trimEnd();
  const commits = output ? output.split("\n").map(line => commitRecord(history, line)) : [];
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
}

export async function captureHistory(root: Repository): Promise<ChangesHistory> {
  const index = await collectReviewIndex(root);
  const history: ChangesHistory = { id: crypto.randomUUID(), commits: [], tips: [], references: [], indexTree: "", emptyTree: "", aheadIds: new Set(), range: { newest: workingTree, oldest: workingTree }, hasStaged: false, hasMore: false, loaded: 0, phase: index.phase };
  if (index.phase !== "ready") return history;
  const [head, branch, refs, emptyTree, indexTree] = await Promise.all([
    git(root, ["rev-parse", "--verify", "HEAD"], true),
    git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], true),
    git(root, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(*objectname)", "refs/heads", "refs/remotes", "refs/tags"]),
    git(root, ["hash-object", "-t", "tree", "/dev/null"]),
    root.captureIndexTree(),
  ]);
  history.head = head.toString().trim() || undefined;
  history.branch = branch.toString().trim() || undefined;
  history.emptyTree = emptyTree.toString().trim();
  history.indexTree = indexTree.toString().trim();
  history.hasStaged = (await git(root, ["diff", "--name-only", history.head ?? history.emptyTree, history.indexTree, "--"])).byteLength > 0;
  for (const line of refs.toString().trimEnd().split("\n")) {
    if (!line) continue;
    const [ref, hash, peeled] = line.split("\0");
    const kind = ref!.startsWith("refs/heads/") ? "local" : ref!.startsWith("refs/remotes/") ? "remote" : "tag";
    const name = ref!.replace(/^refs\/(heads|remotes|tags)\//, "");
    if (kind === "remote" && name.endsWith("/HEAD")) continue;
    history.references.push({ name, kind, id: peeled || hash! });
  }
  history.tips = [...new Set([...(history.head ? [history.head] : []), ...history.references.filter(ref => ref.kind === "local").map(ref => ref.id)])];
  if (history.head && history.branch) {
    const upstream = (await git(root, ["for-each-ref", "--format=%(upstream:short)%00%(upstream)", `refs/heads/${history.branch}`])).toString().trimEnd().split("\0");
    if (upstream[0]) {
      const upstreamId = (await git(root, ["rev-parse", "--verify", upstream[1]!], true)).toString().trim();
      if (upstreamId) {
        history.upstream = upstream[0];
        history.upstreamId = upstreamId;
        history.aheadIds = new Set((await git(root, ["rev-list", "--topo-order", history.head, "--not", upstreamId, "--"])).toString().trim().split("\n").filter(Boolean));
      }
    }
  }
  const synthetic = (id: string, kind: "working" | "staged", subject: string, parents: string[]): ChangesCommit => ({ id, kind, subject, parents, author: "You", date: "Now", refs: [], ahead: false });
  history.commits.push(synthetic(workingTree, "working", "Working tree", history.hasStaged ? [stagedChanges] : history.head ? [history.head] : []));
  if (history.hasStaged) history.commits.push(synthetic(stagedChanges, "staged", "Staged changes", history.head ? [history.head] : []));
  history.range = { newest: workingTree, oldest: history.hasStaged ? stagedChanges : workingTree };
  if (history.aheadIds.size) {
    const oldestId = [...history.aheadIds].at(-1)!;
    const [oldest, base] = await Promise.all([
      git(root, ["show", "--no-patch", `--format=${commitFormat}`, oldestId, "--"]),
      git(root, ["merge-base", history.head!, history.upstreamId!]),
    ]);
    history.unpushed = { oldest: commitRecord(history, oldest.toString().trimEnd()), base: base.toString().trim(), count: history.aheadIds.size };
    history.range = { newest: workingTree, oldest: oldestId, unpushed: true };
  }
  const page = await commitHistory(root, history, 0, 8);
  history.commits.push(...page.commits);
  history.loaded = page.commits.length;
  history.hasMore = page.hasMore;
  return history;
}

/** Endpoints are object IDs (or captured index/working-tree states), never moving Git expressions. */
export async function captureChanges(root: Repository, range?: ChangesRange, capturedHistory?: ChangesHistory): Promise<ChangesSnapshot> {
  const history = capturedHistory ?? await captureHistory(root);
  range ??= history.range;
  const snapshot: ChangesSnapshot = { id: crypto.randomUUID(), index: { phase: "not-git" }, stats: [], files: new Map(), history, range, label: "Changes", baseLabel: "", endLabel: "" };
  if (history.phase !== "ready") return snapshot;
  const newestIndex = history.commits.findIndex(commit => commit.id === range.newest);
  const oldestIndex = history.commits.findIndex(commit => commit.id === range.oldest);
  const unpushed = isUnpushedRange(history.unpushed, range) ? history.unpushed : undefined;
  if (range.unpushed && !unpushed) throw new InvalidChangesRange("This branch’s unpushed range has changed. Refresh Changes.");
  if (newestIndex === -1 || (oldestIndex === -1 && !unpushed) || (oldestIndex !== -1 && newestIndex > oldestIndex)) throw new InvalidChangesRange("These endpoints aren’t in this history or are in reverse order.");
  const oldest = unpushed?.oldest ?? history.commits[oldestIndex]!;
  snapshot.base = unpushed ? unpushed.base : oldest.kind === "working" ? history.hasStaged ? history.indexTree : history.head ?? history.emptyTree
    : oldest.kind === "staged" ? history.head ?? history.emptyTree : oldest.parents[0] ?? history.emptyTree;
  snapshot.end = range.newest === workingTree ? undefined : range.newest === stagedChanges ? history.indexTree : range.newest;
  snapshot.baseLabel = unpushed && snapshot.base === history.upstreamId ? history.upstream! : snapshot.base === history.emptyTree ? "Empty tree" : snapshot.base === history.indexTree ? "Staged changes" : endpointName(history, snapshot.base);
  snapshot.endLabel = endpointName(history, range.newest);
  let count: number | undefined;
  if (!unpushed && oldest.kind === "commit" && ancestryPath(history.commits, range.newest, range.oldest).length && range.newest !== range.oldest) {
    const endCommit = range.newest === workingTree || range.newest === stagedChanges ? history.head : range.newest;
    if (endCommit) count = Number((await git(root, ["rev-list", "--count", endCommit, ...(snapshot.base === history.emptyTree ? [] : ["--not", snapshot.base]), "--"])).toString());
  }
  snapshot.label = rangeDescription(history, range, count);
  const comparison = await collectReviewComparison(root, snapshot.base, snapshot.end);
  snapshot.index = comparison.index;
  snapshot.stats = comparison.stats;
  snapshot.files = comparison.files;
  for (const file of snapshot.files.values()) if (file.diff) file.diff.cacheKey = `${snapshot.id}:${file.path}`;
  return snapshot;
}
