import { createWorkspaceMetadataState, type WorkspaceMetadataState } from "@agents-in-the-cloud/workspace";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { captureCommentAnchor, locateCommentAnchor, reviewCommentSchema, reviewComparisonKey, sortedComments, type CommentPlacement, type ReviewComment } from "../comments.ts";
import type { ChangesSnapshot } from "./snapshot.ts";

const stateSchema = Type.Object({ comments: Type.Array(reviewCommentSchema) });
export class CommentConflict extends Error {}
export class InvalidComment extends Error {}
export interface CommentVersion { id: string; revision: number }

export function createReviewCommentStore(options: { dataDir?: string } = {}) {
  const state: WorkspaceMetadataState<{ comments: ReviewComment[] }> = createWorkspaceMetadataState("review-comments.json", value => Value.Parse(stateSchema, value), () => ({ comments: [] }), options);
  const list = (workspaceId: string) => sortedComments(state.read(workspaceId).comments);
  function existing(workspaceId: string, id: string, revision: number): ReviewComment {
    const comment = list(workspaceId).find(comment => comment.id === id);
    if (!comment || comment.revision !== revision) throw new CommentConflict(comment ? "This comment changed in another view. Your text is still here; reopen the latest comment before saving." : "This comment was deleted in another view. Your text is still here.");
    return comment;
  }
  function bodyText(body: string): string {
    const text = body.trim();
    if (!text || text.length > 10000) throw new InvalidComment("Add a comment of up to 10,000 characters.");
    return text;
  }
  function save(workspaceId: string, input: { id: string; revision: number; body: string; path?: string; side?: ReviewComment["side"]; start?: number; end?: number }, snapshot: ChangesSnapshot): ReviewComment {
    const body = bodyText(input.body);
    let comment: ReviewComment;
    if (input.revision) {
      const previous = existing(workspaceId, input.id, input.revision);
      if (body === previous.body) return previous;
      comment = { ...previous, body, revision: previous.revision + 1 };
    } else {
      if (list(workspaceId).some(comment => comment.id === input.id)) throw new CommentConflict("This comment has already been saved. Reopen it to edit.");
      const { path, side, start, end } = input;
      const file = path === undefined ? undefined : snapshot.files.get(path);
      const contents = side === "deletions" ? file?.oldContents : file?.newContents;
      if (!file?.diff || contents === undefined || !side || start === undefined || end === undefined) throw new InvalidComment("Select lines in a text diff.");
      let anchor: ReviewComment["anchor"];
      try { anchor = captureCommentAnchor(contents, start, end); }
      catch (error) { if (!(error instanceof RangeError)) throw error; throw new InvalidComment(error.message); }
      comment = {
        id: input.id, revision: 1, copiedRevision: 0, body, path: file.path, side, start, end, anchor,
        comparison: { key: comparisonKey(snapshot), label: snapshot.label, baseLabel: snapshot.baseLabel, targetLabel: snapshot.targetLabel, base: snapshot.base ?? null, target: snapshot.target ?? "working" },
      };
    }
    state.write(workspaceId, { comments: [...list(workspaceId).filter(entry => entry.id !== comment.id), comment] });
    return comment;
  }
  function removeMany(workspaceId: string, versions: readonly CommentVersion[]): void {
    for (const { id, revision } of versions) existing(workspaceId, id, revision);
    const ids = new Set(versions.map(version => version.id));
    state.write(workspaceId, { comments: list(workspaceId).filter(comment => !ids.has(comment.id)) });
  }
  function remove(workspaceId: string, id: string, revision: number): void {
    removeMany(workspaceId, [{ id, revision }]);
  }
  function markCopied(workspaceId: string, versions: readonly CommentVersion[]): void {
    const revisions = new Map(versions.map(version => [version.id, version.revision]));
    state.write(workspaceId, { comments: list(workspaceId).map(comment => revisions.get(comment.id) === comment.revision ? { ...comment, copiedRevision: comment.revision } : comment) });
  }
  return { list, save, remove, removeMany, markCopied, delete: (workspaceId: string) => state.delete(workspaceId) };
}
export type ReviewCommentStore = ReturnType<typeof createReviewCommentStore>;
export const reviewComments = createReviewCommentStore();

export function comparisonKey(snapshot: ChangesSnapshot): string {
  const resolvedBase = snapshot.endpoints.base === undefined
    ? snapshot.history.topology.find(commit => commit.id === snapshot.endpoints.target)?.parents[0] ?? null
    : snapshot.endpoints.base;
  return reviewComparisonKey({ endpoints: snapshot.endpoints, head: snapshot.history.head, resolvedBase });
}

export function placeReviewComments(comments: readonly ReviewComment[], snapshot: ChangesSnapshot): CommentPlacement[] {
  return sortedComments(comments).map(comment => {
    if (comment.comparison.key !== comparisonKey(snapshot)) return { ...comment, status: "other" };
    const file = snapshot.files.get(comment.path);
    const contents = comment.side === "deletions" ? file?.oldContents : file?.newContents;
    const location = contents === undefined || file?.previousPath ? undefined : locateCommentAnchor(comment.anchor, contents);
    if (!file?.diff || !location) return { ...comment, status: "changed" };
    return { ...comment, status: "inline", placedStart: location.start, placedEnd: location.end };
  });
}
