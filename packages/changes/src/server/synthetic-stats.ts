import { collectReviewStats, type ReviewFileSummary } from "@agents-in-the-cloud/review/diff";
import { git, type Repository } from "@agents-in-the-cloud/workspace/git";
import type { ChangesNodeStats } from "../history.ts";

function numstat(output: Buffer) {
  const fields = output.toString("utf8").split("\0");
  const totals = { files: 0, additions: 0, deletions: 0 };
  const paths = new Set<string>();
  for (let cursor = 0; cursor < fields.length;) {
    const field = fields[cursor++]!;
    if (!field) continue;
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(field);
    if (!match) throw new Error("Invalid Git numstat response");
    let path = match[3]!;
    if (!path) {
      // Rename records put the old and new paths in the next two NUL-delimited fields.
      cursor++;
      path = fields[cursor++]!;
      if (!path) throw new Error("Missing renamed path in Git numstat response");
    }
    paths.add(path);
    totals.files++;
    totals.additions += match[1] === "-" ? 0 : Number(match[1]);
    totals.deletions += match[2] === "-" ? 0 : Number(match[2]);
  }
  return { totals, paths };
}

/** Each synthetic row describes its own layer, independently of the selected comparison. */
export async function captureSyntheticStats(root: Repository, headTree: string, indexTree: string, files: ReviewFileSummary[]): Promise<{ staged: ChangesNodeStats; working: ChangesNodeStats }> {
  const [staged, working, untracked] = await Promise.all([
    git(root, ["diff", "--numstat", "-z", "-M", headTree, indexTree, "--"]),
    git(root, ["diff", "--numstat", "-z", "-M", indexTree, "--"]),
    collectReviewStats(root, { phase: "ready", files: files.filter(file => file.untracked) }),
  ]);
  const captured = numstat(working);
  for (const file of untracked) {
    if (captured.paths.has(file.path)) continue;
    captured.totals.files++;
    captured.totals.additions += file.additions;
    captured.totals.deletions += file.deletions;
  }
  return { staged: numstat(staged).totals, working: captured.totals };
}
