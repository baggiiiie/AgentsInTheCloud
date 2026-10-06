import type { ChangesCommit } from "./history-model.ts";
export interface AncestryEdge { from: string; to: string }

export type ComparisonCommit = Pick<ChangesCommit, "id" | "parents">;
/** Omit Start for a single commit: its first parent is the baseline. */
export interface ComparisonEndpoints { end: string; start?: string | null }
export interface ComparisonSelection {
  start: string | null;
  end: string;
  implicitStart: boolean;
  connection: "connected" | "disconnected" | "unknown";
  complete: boolean;
  /** ALL nodes on directed routes from Start to End, excluding Start. */
  path: string[];
  /** Real parent edges from loaded path nodes, including edges INTO Start. */
  trace: AncestryEdge[];
  selectedRows: string[];
  roles: { id: string; dot: "end" | "path" | "ordinary"; rowSelected: boolean }[];
}
function reachable(start: string, next: (id: string) => readonly string[]): Set<string> {
  const visited = new Set<string>(), stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    stack.push(...next(id));
  }
  return visited;
}

/**
 * Two snapshot endpoints, not an inclusive commit range. A merge selected alone
 * uses its FIRST parent; an explicit pair compares exactly those two snapshots.
 * Ancestry determines their direction, independently of input order.
 *
 * Highlight ALL connecting routes: ancestors(End) ∩ descendants(Start), minus
 * Start. This is not "all commits contributing changes": a merge edge can carry
 * changes authored outside those routes. Disconnected pairs have no path.
 *
 * `commits` is known topology. `loaded` projects it onto a paged history; outgoing
 * highlighted edges may continue off-page only when real connectivity is known.
 * All loaded commits remain visible; selection only changes their visual roles.
 * Unknown ancestry never fabricates a route.
 */
export function selectComparison(commits: readonly ComparisonCommit[], endpoints: ComparisonEndpoints, loaded = commits.map(commit => commit.id)): ComparisonSelection {
  const byId = new Map(commits.map(commit => [commit.id, commit]));
  if (endpoints.start === endpoints.end) throw new RangeError("Select two different snapshots.");
  let end = endpoints.end;
  let start = endpoints.start === undefined ? byId.get(end)?.parents[0] ?? null : endpoints.start;
  let ancestors = reachable(end, id => byId.get(id)?.parents ?? []);
  if (start !== null && !ancestors.has(start)) {
    const otherAncestors = reachable(start, id => byId.get(id)?.parents ?? []);
    // Ancestry, not click order or row position, determines the direction.
    // Unrelated snapshots have no ancestry direction. Keep their order stable
    // in the captured history (also keeping synthetic working state on End).
    const endRow = commits.findIndex(commit => commit.id === end), startRow = commits.findIndex(commit => commit.id === start);
    if (otherAncestors.has(end) || (endRow !== -1 && startRow !== -1 && endRow > startRow)) {
      [start, end] = [end, start];
      ancestors = otherAncestors;
    }
  }
  if (!byId.has(end) || !loaded.includes(end)) throw new RangeError("End must be in the loaded history");
  const children = new Map<string, string[]>();
  for (const commit of commits) for (const parent of commit.parents) {
    const descendants = children.get(parent) ?? [];
    descendants.push(commit.id);
    children.set(parent, descendants);
  }
  const connected = start === null || ancestors.has(start);
  const incomplete = [...ancestors].some(id => !byId.has(id));
  const connection = connected ? "connected" : incomplete ? "unknown" : "disconnected";
  // A known topological prefix contains every route to a known baseline. An
  // unloaded baseline may have unknown alternative arms, even with one proven edge.
  const complete = connection !== "unknown" && (start === null ? !incomplete : byId.has(start) || ![...ancestors].some(id => id !== start && !byId.has(id)));
  const descendants = start === null ? ancestors : reachable(start, id => children.get(id) ?? []);
  const corridor = new Set(connected ? [...ancestors].filter(id => descendants.has(id)) : []);
  const path = commits.filter(commit => corridor.has(commit.id) && commit.id !== start).map(commit => commit.id);
  const pathIds = new Set(path), loadedIds = new Set(loaded);
  const trace = commits.flatMap(commit => loadedIds.has(commit.id) && pathIds.has(commit.id)
    ? commit.parents.filter(parent => corridor.has(parent)).map(parent => ({ from: commit.id, to: parent })) : []);
  // An inferred parent defines the diff and path, not an explicit user selection.
  const selectedRows = loaded.filter(id => id === end || (endpoints.start !== undefined && id === start));
  const roles = loaded.map(id => ({ id, dot: id === end ? "end" as const : pathIds.has(id) ? "path" as const : "ordinary" as const, rowSelected: selectedRows.includes(id) }));
  return { start, end, implicitStart: endpoints.start === undefined, connection, complete, path, trace, selectedRows, roles };
}
