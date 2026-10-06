import type { Repository } from "@agents-in-the-cloud/workspace/git";
import { isUnpushedRange, type ChangesRange } from "../history.ts";
import { captureChanges, captureHistory, commitHistory, stagedChanges, workingTree, type ChangesSnapshot } from "./snapshot.ts";

/** Manual and turn-end refresh share the same endpoint-preservation rules. */
export async function refreshChanges(root: Repository, previous: ChangesSnapshot, requested = previous.range): Promise<ChangesSnapshot> {
  const history = await captureHistory(root);
  let range: ChangesRange = { ...requested };
  const initial = previous.history.range;
  const followsDefault = range.newest === initial.newest && range.oldest === initial.oldest && range.unpushed === initial.unpushed;
  if (followsDefault || isUnpushedRange(previous.history.unpushed, range)) range = history.range;
  // Preserve all-uncommitted selection when staging introduces its node.
  if (!previous.history.hasStaged && history.hasStaged && range.newest === workingTree && range.oldest === workingTree) range.oldest = stagedChanges;
  if (!history.hasStaged) {
    if (range.newest === stagedChanges) range.newest = workingTree;
    if (range.oldest === stagedChanges) range.oldest = workingTree;
  }
  while (!isUnpushedRange(history.unpushed, range) && history.hasMore && (!history.commits.some(commit => commit.id === range.oldest) || !history.commits.some(commit => commit.id === range.newest))) {
    const page = await commitHistory(root, history, history.loaded);
    history.commits.push(...page.commits);
    history.loaded += page.commits.length;
    history.hasMore = page.hasMore;
  }
  return captureChanges(root, range, history);
}
