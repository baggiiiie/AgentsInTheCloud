import { selectComparison } from "../comparison-selection.ts";
import { captureSyntheticStats } from "./synthetic-stats.ts";
import { collectReviewComparison, collectReviewIndex, type ReviewFile, type ReviewFileStats, type ReviewIndex } from "@agents-in-the-cloud/review/diff";
import { git, type Repository } from "@agents-in-the-cloud/workspace/git";
import { endpointName, rangeDescription, stagedChanges, workingTree, type ChangesCommit, type ChangesRange, type HistoryModel } from "../history.ts";
export { stagedChanges, workingTree } from "../history.ts";
export type { ChangesCommit, ChangesRange } from "../history.ts";

export interface ChangesHistory extends HistoryModel {
  id: string;
  tips: string[];
  indexTree: string;
  emptyTree: string;
  upstreamId?: string;
  branch?: string;
  hasStaged: boolean;
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
  const history: ChangesHistory = { id: crypto.randomUUID(), commits: [], topology: [], tips: [], references: [], indexTree: "", emptyTree: "", aheadIds: new Set(), range: { end: workingTree }, hasStaged: false, hasMore: false, loaded: 0, phase: index.phase };
  if (index.phase !== "ready") return history;
  const [head, branch, refs, emptyTree, indexTree] = await Promise.all([
    git(root, ["rev-parse", "--verify", "HEAD"], true),
    git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], true),
    git(root, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(upstream)"]),
    git(root, ["hash-object", "-t", "tree", "/dev/null"]),
    root.captureIndexTree(),
  ]);
  history.head = head.toString().trim() || undefined;
  history.branch = branch.toString().trim() || undefined;
  history.emptyTree = emptyTree.toString().trim();
  history.indexTree = indexTree.toString().trim();
  const refIds = new Map<string, string>();
  let upstreamRef: string | undefined;
  for (const line of refs.toString().trimEnd().split("\n")) {
    if (!line) continue;
    const [ref, hash, peeled, upstreamName, upstream] = line.split("\0");
    refIds.set(ref!, hash!);
    if (ref === `refs/heads/${history.branch}` && upstreamName) {
      history.upstream = upstreamName;
      upstreamRef = upstream;
    }
    if (!/^refs\/(heads|remotes|tags)\//.test(ref!)) continue;
    const kind = ref!.startsWith("refs/heads/") ? "local" : ref!.startsWith("refs/remotes/") ? "remote" : "tag";
    const name = ref!.replace(/^refs\/(heads|remotes|tags)\//, "");
    if (kind === "remote" && name.endsWith("/HEAD")) continue;
    history.references.push({ name, kind, id: peeled || hash! });
  }
  history.tips = [...new Set([...(history.head ? [history.head] : []), ...history.references.filter(ref => ref.kind === "local").map(ref => ref.id)])];
  history.upstreamId = upstreamRef ? refIds.get(upstreamRef) : undefined;
  if (!history.upstreamId) history.upstream = undefined;
  const [syntheticStats, ahead, pageOutput, topologyOutput] = await Promise.all([
    captureSyntheticStats(root, history.head ?? history.emptyTree, history.indexTree, index.files),
    history.head && history.upstreamId ? git(root, ["rev-list", "--topo-order", history.head, "--not", history.upstreamId, "--"]) : Buffer.alloc(0),
    history.tips.length ? git(root, ["log", "--topo-order", "--max-count=9", `--format=${commitFormat}`, ...history.tips, "--"]) : Buffer.alloc(0),
    history.tips.length ? git(root, ["rev-list", "--topo-order", "--parents", ...history.tips, "--"]) : Buffer.alloc(0),
  ]);
  history.hasStaged = syntheticStats.staged.files > 0;
  history.aheadIds = new Set(ahead.toString().trim().split("\n").filter(Boolean));
  const synthetic = (id: string, kind: "working" | "staged", subject: string, parents: string[]): ChangesCommit => ({ id, kind, subject, parents, author: "You", date: "Now", refs: [], ahead: false, stats: syntheticStats[kind] });
  history.commits.push(synthetic(workingTree, "working", "Working tree", history.hasStaged ? [stagedChanges] : history.head ? [history.head] : []));
  if (history.hasStaged) history.commits.push(synthetic(stagedChanges, "staged", "Staged changes", history.head ? [history.head] : []));
  history.range = { end: workingTree, start: history.head ?? null };
  if (history.aheadIds.size) {
    const base = (await git(root, ["merge-base", history.head!, history.upstreamId!])).toString().trim();
    history.unpushed = { base, count: history.aheadIds.size };
    history.range = { end: workingTree, start: base };
  }
  history.topology = [...history.commits.map(({ id, parents }) => ({ id, parents })), ...topologyOutput.toString().trim().split("\n").filter(Boolean).map(line => {
    const [id, ...parents] = line.split(" ");
    return { id: id!, parents };
  })];
  const output = pageOutput.toString("utf8").trimEnd();
  const commits = output ? output.split("\n").map(line => commitRecord(history, line)) : [];
  history.commits.push(...commits.slice(0, 8));
  history.loaded = Math.min(commits.length, 8);
  history.hasMore = commits.length > 8;
  return history;
}

/** Endpoints are object IDs (or captured index/working-tree states), never moving Git expressions. */
export async function captureChanges(root: Repository, range?: ChangesRange, capturedHistory?: ChangesHistory): Promise<ChangesSnapshot> {
  const history = capturedHistory ?? await captureHistory(root);
  range ??= history.range;
  const snapshot: ChangesSnapshot = { id: crypto.randomUUID(), index: { phase: "not-git" }, stats: [], files: new Map(), history, range, label: "Changes", baseLabel: "", endLabel: "" };
  if (history.phase !== "ready") return snapshot;
  // Only pinned IDs from this history may reach Git. The full compact topology
  // makes direction and ALL connecting routes independent of history paging.
  if (!history.commits.some(commit => commit.id === range.end) || (range.start != null && !history.topology.some(commit => commit.id === range.start))) throw new InvalidChangesRange("These endpoints aren’t in this history. Refresh Changes.");
  let selected;
  try { selected = selectComparison(history.topology, range, history.commits.map(commit => commit.id)); }
  catch (error) { if (!(error instanceof RangeError)) throw error; throw new InvalidChangesRange(error.message); }
  snapshot.range = { end: selected.end };
  if (range.start !== undefined) snapshot.range.start = selected.start;
  snapshot.base = selected.start === null ? history.emptyTree : selected.start === stagedChanges ? history.indexTree : selected.start;
  snapshot.end = selected.end === workingTree ? undefined : selected.end === stagedChanges ? history.indexTree : selected.end;
  snapshot.baseLabel = snapshot.base === history.emptyTree ? "Empty tree" : snapshot.base === history.indexTree ? "Staged changes" : endpointName(history, selected.start ?? undefined);
  snapshot.endLabel = endpointName(history, selected.end);
  snapshot.label = rangeDescription(history, selected);
  const comparison = await collectReviewComparison(root, snapshot.base, snapshot.end);
  snapshot.index = comparison.index;
  snapshot.stats = comparison.stats;
  snapshot.files = comparison.files;
  for (const file of snapshot.files.values()) if (file.diff) file.diff.cacheKey = `${snapshot.id}:${file.path}`;
  return snapshot;
}
