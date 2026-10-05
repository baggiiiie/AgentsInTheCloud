import { collectReviewFile, collectReviewIndex, collectReviewStats, type ReviewFile, type ReviewFileStats, type ReviewIndex } from "@agents-in-the-cloud/review/diff";

export interface ChangesSnapshot {
  id: string;
  index: ReviewIndex;
  stats: ReviewFileStats[];
  files: Map<string, ReviewFile>;
}

/** Capture once so loading or revisiting a file never substitutes newer workspace contents. */
export async function captureChanges(root: string): Promise<ChangesSnapshot> {
  const index = await collectReviewIndex(root);
  const snapshot: ChangesSnapshot = { id: crypto.randomUUID(), index, stats: await collectReviewStats(root, index), files: new Map() };
  if (index.phase !== "ready") return snapshot;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, index.files.length) }, async () => {
    while (cursor < index.files.length) {
      const summary = index.files[cursor++]!;
      const file = await collectReviewFile(root, summary.path);
      if (!file) throw new Error(`File changed while capturing Changes: ${summary.path}. Refresh to capture it again.`);
      if (file.diff) file.diff.cacheKey = `${snapshot.id}:${file.path}`;
      snapshot.files.set(file.path, file);
    }
  }));
  return snapshot;
}
