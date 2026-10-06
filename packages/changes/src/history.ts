export const workingTree = "working";
export const stagedChanges = "staged";
export interface ChangesRange { newest: string; oldest: string; unpushed?: true }
export interface ChangesRef { name: string; kind: "local" | "remote" | "tag" }
export interface ChangesNodeStats { files: number; additions: number; deletions: number }
export interface ChangesCommit {
  id: string;
  parents: string[];
  subject: string;
  author: string;
  date: string;
  refs: ChangesRef[];
  ahead: boolean;
  kind: "commit" | "working" | "staged";
  stats?: ChangesNodeStats;
}
export interface UnpushedHistory { oldest: ChangesCommit; base: string; count: number }
export interface HistoryModel {
  commits: ChangesCommit[];
  references: (ChangesRef & { id: string })[];
  range: ChangesRange;
  head?: string;
  branch?: string;
  upstream?: string;
  hasStaged: boolean;
  unpushed?: UnpushedHistory;
}
export interface GraphNode { commit: ChangesCommit; row: number; lane: number }
export interface GraphEdge { from: string; to: string; d: string; lane: number }
export interface HistoryGraph { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number }
export const rowHeight = 36;
const laneWidth = 16;
const x = (lane: number) => 12 + lane * laneWidth;
const y = (row: number) => row * rowHeight + rowHeight / 2;

/** Allocate a first-parent spine and pending branch lanes for a topological history prefix. */
export function historyGraph(commits: ChangesCommit[]): HistoryGraph {
  const byCommit = new Map(commits.map(commit => [commit.id, commit]));
  const primary = new Set<string>();
  for (let id: string | undefined = commits[0]?.id; id; id = byCommit.get(id)?.parents[0]) primary.add(id);
  const lanes: (string | undefined)[] = [];
  const nodes: GraphNode[] = [];
  const pending: { from: GraphNode; to: string; lane: number }[] = [];
  const vacant = () => { const slot = lanes.indexOf(undefined, 1); return slot === -1 ? Math.max(1, lanes.length) : slot; };
  let maximumLane = 0;
  for (const [row, commit] of commits.entries()) {
    let lane = primary.has(commit.id) ? 0 : lanes.indexOf(commit.id);
    if (lane === -1) lane = vacant();
    const node = { commit, row, lane };
    nodes.push(node);
    for (const [index, pendingId] of lanes.entries()) if (pendingId === commit.id) lanes[index] = undefined;
    for (const [index, parent] of commit.parents.entries()) {
      let parentLane = primary.has(parent) ? 0 : lanes.indexOf(parent);
      if (parentLane === 0) lanes[primary.has(commit.id) ? 0 : lane] = parent;
      if (parentLane === -1) {
        parentLane = index === 0 && lanes[lane] === undefined ? lane : vacant();
        lanes[parentLane] = parent;
      }
      maximumLane = Math.max(maximumLane, lane, parentLane);
      pending.push({ from: node, to: parent, lane: parentLane });
    }
  }
  const byId = new Map(nodes.map(node => [node.commit.id, node]));
  const height = commits.length * rowHeight;
  const edges = pending.map(({ from, to, lane }): GraphEdge => {
    const parent = byId.get(to);
    const xx = x(from.lane), px = x(parent?.lane ?? (lane < from.lane ? from.lane : lane)), yy = y(from.row), py = parent ? y(parent.row) : height;
    const bend = Math.min(28, py - yy);
    const d = xx === px ? `M ${xx} ${yy} L ${px} ${py}`
      : px < xx ? `M ${xx} ${yy} L ${xx} ${py - bend} C ${xx} ${py - bend + 10} ${px} ${py - bend + 10} ${px} ${py - 8} L ${px} ${py}`
      : `M ${xx} ${yy} L ${xx} ${yy + 8} C ${xx} ${yy + bend - 10} ${px} ${yy + bend - 10} ${px} ${yy + bend} L ${px} ${py}`;
    return { from: from.commit.id, to, d, lane: from.lane };
  });
  return { nodes, edges, width: Math.max(64, x(maximumLane) + 16), height };
}

/** One real ancestry path, never a fabricated connection across branches. */
export function ancestryPath(commits: ChangesCommit[], newest: string, oldest: string): string[] {
  const byId = new Map(commits.map(commit => [commit.id, commit]));
  const visited = new Set<string>();
  const previous = new Map<string, string>();
  const stack: { id: string; via?: string }[] = [{ id: newest }];
  while (stack.length) {
    const { id, via } = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (via) previous.set(id, via);
    if (id === oldest) {
      const result = [id];
      for (let parent = previous.get(id); parent; parent = previous.get(parent)) result.push(parent);
      return result.reverse();
    }
    for (const parent of [...(byId.get(id)?.parents ?? [])].reverse()) stack.push({ id: parent, via: id });
  }
  return [];
}

/** Commits contributing to an inclusive range: all End ancestors minus Start's first-parent ancestors. */
export function comparisonAncestry(commits: ChangesCommit[], range: ChangesRange): string[] {
  if (range.newest === range.oldest) return [range.newest];
  if (!ancestryPath(commits, range.newest, range.oldest).length) return [];
  const byId = new Map(commits.map(commit => [commit.id, commit]));
  const reachable = (start: string | undefined) => {
    const result = new Set<string>();
    const stack = start ? [start] : [];
    while (stack.length) {
      const id = stack.pop()!;
      if (result.has(id)) continue;
      result.add(id);
      stack.push(...(byId.get(id)?.parents ?? []));
    }
    return result;
  };
  const excluded = reachable(byId.get(range.oldest)!.parents[0]);
  const included = reachable(range.newest);
  return commits.filter(commit => included.has(commit.id) && !excluded.has(commit.id)).map(commit => commit.id);
}

export function endpointName(model: Pick<HistoryModel, "references">, id: string | undefined): string {
  if (!id) return "Empty tree";
  if (id === workingTree) return "Working tree";
  if (id === stagedChanges) return "Staged changes";
  const refs = model.references.filter(ref => ref.id === id);
  return refs.find(ref => ref.kind === "local")?.name ?? refs.find(ref => ref.kind === "remote")?.name ?? refs.find(ref => ref.kind === "tag")?.name ?? id.slice(0, 7);
}

export function isUnpushedRange(unpushed: UnpushedHistory | undefined, range: ChangesRange): unpushed is UnpushedHistory {
  return !!unpushed && range.unpushed === true && range.newest === workingTree && range.oldest === unpushed.oldest.id;
}

export function rangeDescription(model: HistoryModel, range: ChangesRange, count?: number): string {
  if (isUnpushedRange(model.unpushed, range)) return `Unpushed changes · ${model.unpushed.count} ${model.unpushed.count === 1 ? "commit" : "commits"}`;
  const { commits, head, hasStaged } = model;
  const newest = commits.find(commit => commit.id === range.newest)!;
  const oldest = commits.find(commit => commit.id === range.oldest)!;
  if (oldest.kind === "staged") return newest.kind === "staged" ? "Staged changes" : "Uncommitted changes";
  if (oldest.kind === "working") return hasStaged ? "Unstaged changes" : "Uncommitted changes";
  const name = (id: string | undefined) => endpointName(model, id);
  if (newest.id === oldest.id) return `${name(newest.id)} · ${newest.subject}`;
  const path = comparisonAncestry(commits, range);
  const base = oldest.parents[0];
  const baseline = model.references.filter(ref => ref.id === base);
  const includesWorking = newest.kind === "working";
  const includesStaged = newest.kind === "staged";
  const suffix = includesWorking ? " + uncommitted" : includesStaged ? " + staged" : "";
  if (path.length) {
    const total = count ?? path.filter(id => commits.find(commit => commit.id === id)!.kind === "commit").length;
    if (baseline.some(ref => ref.kind !== "tag") && base !== head) return `${total} ${total === 1 ? "commit" : "commits"}${suffix} ahead of ${name(base)}`;
    return `${total} ${total === 1 ? "commit" : "commits"}${suffix} · ${name(oldest.id)}…${name(newest.id)}`;
  }
  return `${name(base)} → ${name(newest.id)}`;
}

/** Local and tracking labels share a hue; the remote name is not part of their identity. */
export function branchColor(name: string, kind: ChangesRef["kind"] = "local"): number {
  const key = kind === "remote" ? name.slice(name.indexOf("/") + 1) : name;
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return (hash >>> 0) % 8;
}

/** Highlight End's actual ancestry within the selected rows, never a later enclosing merge. */
function rangeCorridor(commits: ChangesCommit[], range: ChangesRange, unpushed?: UnpushedHistory) {
  const byId = new Map(commits.map(commit => [commit.id, commit]));
  const first = commits.findIndex(commit => commit.id === range.newest);
  const oldestIndex = commits.findIndex(commit => commit.id === range.oldest);
  const last = oldestIndex === -1 && isUnpushedRange(unpushed, range) ? commits.length - 1 : oldestIndex;
  if (isUnpushedRange(unpushed, range)) {
    const covered = new Set(commits.filter(commit => commit.kind !== "commit" || commit.ahead).map(commit => commit.id));
    const path = [...covered];
    const hidden = new Set(commits.filter((commit, row) => row > first && row < last && !covered.has(commit.id)).map(commit => commit.id));
    return { path, covered, hidden, first, last, connected: true };
  }
  const reachable = (start: string | undefined) => {
    const result = new Set<string>();
    const stack = start ? [start] : [];
    while (stack.length) {
      const id = stack.pop()!;
      if (result.has(id)) continue;
      result.add(id);
      stack.push(...(byId.get(id)?.parents ?? []));
    }
    return result;
  };
  const covered = reachable(range.newest);
  const connected = covered.has(range.oldest);
  const excluded = reachable(byId.get(range.oldest)!.parents[0]);
  for (const id of excluded) covered.delete(id);
  if (range.newest === range.oldest) covered.clear();
  const path = commits.filter((commit, row) => row >= first && row <= last && covered.has(commit.id)).map(commit => commit.id);
  const included = new Set([...path, range.newest, range.oldest]);
  const hidden = new Set(commits.filter((commit, row) => row > first && row < last && !included.has(commit.id)).map(commit => commit.id));
  return { path, covered, hidden, first, last, connected };
}

export function selectedGraph(graph: HistoryGraph, range: ChangesRange, unpushed?: UnpushedHistory) {
  const { path, covered, hidden, first, last, connected } = rangeCorridor(graph.nodes.map(node => node.commit), range, unpushed);
  // Keep entering/leaving connections, then clip their paint to the endpoint centers in the SVG.
  const route = connected ? graph.edges.filter(edge => covered.has(edge.from) && !hidden.has(edge.to)).map(edge => edge.d).join(" ") : "";
  return { path, route, hidden, first, last };
}
