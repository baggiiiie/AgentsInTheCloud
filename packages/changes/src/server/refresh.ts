import type { Repository } from "@agents-in-the-cloud/review/diff";
import type { ChangesRange } from "../history.ts";
import { captureChanges, captureHistory, commitHistory, stagedChanges, workingTree, type ChangesSnapshot } from "./snapshot.ts";

/** Manual and turn-end refresh share the same endpoint-preservation rules. */
export async function refreshChanges(root: Repository, previous: ChangesSnapshot, requested = previous.range): Promise<ChangesSnapshot> {
  const history = await captureHistory(root);
  let range: ChangesRange = { ...requested };
  const initial = previous.history.range;
  const followsDefault = range.end === initial.end && range.start === initial.start;
  if (followsDefault) range = history.range;
  if (!history.hasStaged) {
    if (range.end === stagedChanges) range = { end: workingTree };
    else if (range.start === stagedChanges) range.start = history.head ?? null;
  }
  while (history.hasMore && (!history.commits.some(commit => commit.id === range.end) || (!followsDefault && range.start != null && !history.commits.some(commit => commit.id === range.start)))) {
    const page = await commitHistory(root, history, history.loaded);
    history.commits.push(...page.commits);
    history.loaded += page.commits.length;
    history.hasMore = page.hasMore;
  }
  return captureChanges(root, range, history);
}
