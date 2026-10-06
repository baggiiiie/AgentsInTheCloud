import { CommentConflict, InvalidComment, placeReviewComments, reviewComments } from "./comments.ts";
import { deletionCommentsId, renderDeletionComments, commentsActionsId, commentsModelId, orphanCommentsId, renderCommentActions, renderCommentsModel, renderOrphanComments } from "./comment-render.ts";
import { domId, type LiveRegion } from "@agents-in-the-cloud/shared";
import { changesDeletionReview, deletionReviewCommitResponse, deletionReviewFileResponse, clearDeletionReview } from "./deletion.ts";
import { refreshChanges } from "./refresh.ts";
import type { JsonValue } from "@agents-in-the-cloud/core";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { escapeHtml, turboStreamResponse, type WorkspaceModule } from "@agents-in-the-cloud/shared";
import { matchRoute, response, textResponse } from "@agents-in-the-cloud/shared/http";
import { workspaceRepository } from "@agents-in-the-cloud/workspace/git";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { changesBodyId, comparisonId, errorId, historyContentId, renderChanges, renderChangesTitle, renderChangesFile, renderComparison, renderError, renderHistory, renderDiff } from "./render.ts";
import type { DiffEndpoints } from "../history.ts";
import { captureChanges, commitHistory, InvalidDiffEndpoints, type ChangesSnapshot } from "./snapshot.ts";

const reference = { type: "changes" } as const;
const referenceSchema = Type.Object({ type: Type.Literal("changes") });
interface ChangesState { snapshot: ChangesSnapshot; request: number; clients: Map<string, number> }
let invalidateWorkspace: (workspaceId: string) => void;
const states = new Map<string, Promise<ChangesState>>();
function current(workspaceId: string): Promise<ChangesState> {
  let state = states.get(workspaceId);
  if (!state) {
    state = captureChanges(workspaceRepository(workspaceId)).then(snapshot => ({ snapshot, request: 0, clients: new Map<string, number>() }));
    states.set(workspaceId, state);
    void state.catch(() => { if (states.get(workspaceId) === state) states.delete(workspaceId); });
  }
  return state;
}
const replace = (target: string, html: string) => `<turbo-stream action="replace" target="${escapeHtml(target)}"><template>${html}</template></turbo-stream>`;
const diffEndpointsSchema = Type.Object({ target: Type.String(), base: Type.Optional(Type.Union([Type.String(), Type.Null()])) });
const requestSchema = Type.Object({ client: Type.String({ minLength: 1, maxLength: 64 }), sequence: Type.Integer({ minimum: 1 }) });

const commentSaveSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }), revision: Type.Integer({ minimum: 0 }), body: Type.String({ maxLength: 10000 }),
  path: Type.Optional(Type.String({ minLength: 1 })), side: Type.Optional(Type.Union([Type.Literal("additions"), Type.Literal("deletions")])),
  start: Type.Optional(Type.Integer({ minimum: 1 })), end: Type.Optional(Type.Integer({ minimum: 1 })),
});
const commentVersionSchema = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }), revision: Type.Integer({ minimum: 1 }) });
const copiedSchema = Type.Array(commentVersionSchema);
function commentRegions(workspaceId: string, snapshot: ChangesSnapshot, key: string): LiveRegion[] {
  if (key !== snapshot.id) return [{ target: domId("changes", key, "diff"), html: renderDiff(workspaceId, snapshot, true), action: "replace", morph: false }];
  const comments = placeReviewComments(reviewComments.list(workspaceId), snapshot);
  return [
    { target: commentsModelId(key), html: renderCommentsModel(key, comments), action: "replace", morph: false },
    { target: orphanCommentsId(key), html: renderOrphanComments(key, comments), action: "replace" },
    { target: commentsActionsId(key), html: renderCommentActions(workspaceId, key, comments), action: "replace", morph: false },
  ];
}
function commentsResponse(workspaceId: string, snapshot: ChangesSnapshot, key: string): Response {
  return turboStreamResponse(commentRegions(workspaceId, snapshot, key).map(region => replace(region.target, region.html)).join(""));
}

export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "changes",
  deletionReview: changesDeletionReview,
  liveSurfaces: [{ name: "review-comments", async load({ workspaceId, key }) { return commentRegions(workspaceId, (await current(workspaceId)).snapshot, key); } }],
  workViews: [{
    type: "changes",
    parseReference(value: JsonValue) {
      if (!Value.Check(referenceSchema, value)) throw new Error("Changes reference is invalid");
      return reference;
    },
    identity: () => "workspace",
    async render({ workspaceId }) { return renderChanges(workspaceId, (await current(workspaceId)).snapshot); },
  }],
  commands: [{ id: "changes.open", execute: () => ({ createdWorkView: reference }) }],
  staticFiles: { "/deletion.css": { url: new URL("../client/deletion.css", import.meta.url), contentType: "text/css; charset=utf-8" }, "/changes.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" } },
  routes: [{ async handle(request, url) {
    const commentRoute = matchRoute(url, /^\/workspaces\/([^/]+)\/changes\/comments\/(save|delete|delete-many|copied)$/);
    if (commentRoute) {
      if (request.method !== "POST") return textResponse("Method not allowed", { status: 405 });
      const workspaceId = commentRoute[0]!, operation = commentRoute[1]!;
      const data = await request.formData();
      const { snapshot } = await current(workspaceId);
      const key = String(data.get("snapshot") ?? snapshot.id);
      try {
        if (operation === "copied" || operation === "delete-many") {
          let versions: unknown;
          try { versions = JSON.parse(String(data.get("versions"))); }
          catch (error) { if (!(error instanceof SyntaxError)) throw error; return textResponse("Invalid comment revisions", { status: 400 }); }
          if (!Value.Check(copiedSchema, versions)) return textResponse("Invalid comment revisions", { status: 400 });
          if (operation === "copied") reviewComments.markCopied(workspaceId, versions);
          else reviewComments.removeMany(workspaceId, versions);
        } else if (operation === "delete") {
          const version = { id: data.get("id"), revision: Number(data.get("revision")) };
          if (!Value.Check(commentVersionSchema, version)) return textResponse("Invalid comment revision", { status: 400 });
          reviewComments.remove(workspaceId, version.id, version.revision);
        } else {
          const input = {
            id: data.get("id"), revision: Number(data.get("revision")), body: data.get("body"),
            path: data.get("path") ?? undefined, side: data.get("side") ?? undefined,
            start: data.has("start") ? Number(data.get("start")) : undefined,
            end: data.has("end") ? Number(data.get("end")) : undefined,
          };
          if (!Value.Check(commentSaveSchema, input)) return textResponse("Invalid comment", { status: 400 });
          if (input.revision === 0 && key !== snapshot.id) return textResponse("This comparison changed. Your text is still here; refresh Changes before adding this comment.", { status: 409 });
          reviewComments.save(workspaceId, input, snapshot);
        }
      } catch (error) {
        if (!(error instanceof CommentConflict) && !(error instanceof InvalidComment)) throw error;
        return textResponse(error.message, { status: error instanceof CommentConflict ? 409 : 422 });
      }
      invalidateWorkspace(workspaceId);
      return operation === "copied" ? turboStreamResponse(replace(deletionCommentsId(workspaceId), renderDeletionComments(workspaceId, reviewComments.list(workspaceId)))) : commentsResponse(workspaceId, snapshot, key);
    }
    let match = matchRoute(url, /^\/workspaces\/([^/]+)\/changes\/deletion\/file$/);
    if (match) return request.method === "GET" ? await deletionReviewFileResponse(match[0]!, url) : textResponse("Method not allowed", { status: 405 });
    match = matchRoute(url, /^\/workspaces\/([^/]+)\/changes\/deletion\/commit$/);
    if (match) return request.method === "GET" ? await deletionReviewCommitResponse(match[0]!, url) : textResponse("Method not allowed", { status: 405 });
    match = matchRoute(url, /^\/workspaces\/([^/]+)\/changes\/file$/);
    if (match) {
      if (request.method !== "GET") return textResponse("Method not allowed", { status: 405 });
      const { snapshot } = await current(match[0]!);
      if (url.searchParams.get("snapshot") !== snapshot.id) return textResponse("This comparison has changed. Reopen Changes to load the current snapshot.", { status: 409 });
      const file = snapshot.files.get(url.searchParams.get("path") ?? "");
      return file ? response(renderChangesFile(file, snapshot.id)) : textResponse("Changed file not found", { status: 404 });
    }
    match = matchRoute(url, /^\/workspaces\/([^/]+)\/changes\/history$/);
    if (match) {
      if (request.method !== "GET") return textResponse("Method not allowed", { status: 405 });
      const workspaceId = match[0]!, state = await current(workspaceId), history = state.snapshot.history;
      if (url.searchParams.get("history") !== history.id) return textResponse("This history has been refreshed.", { status: 409 });
      const skip = Number(url.searchParams.get("skip"));
      if (!Number.isInteger(skip) || skip !== history.loaded) return textResponse("Invalid history page", { status: 400 });
      const page = await commitHistory(workspaceRepository(workspaceId), history, skip);
      // A refresh may have replaced this history while Git was reading its pinned tips.
      if (state.snapshot.history !== history || history.loaded !== skip) return new Response(null, { status: 204 });
      history.commits.push(...page.commits);
      history.loaded += page.commits.length;
      history.hasMore = page.hasMore;
      return turboStreamResponse(replace(historyContentId(history), renderHistory(state.snapshot)));
    }
    match = matchRoute(url, /^\/workspaces\/([^/]+)\/changes\/(refresh|compare)$/);
    if (!match) return undefined;
    if (request.method !== "POST") return textResponse("Method not allowed", { status: 405 });
    const workspaceId = match[0]!, state = await current(workspaceId), previous = state.snapshot;
    const data = await request.formData();
    if (data.get("history") !== previous.history.id) return textResponse("This history has been refreshed. Reopen Changes.", { status: 409 });
    const order = { client: data.get("client"), sequence: Number(data.get("sequence")) };
    if (!Value.Check(requestSchema, order)) return textResponse("Invalid comparison request", { status: 400 });
    if (order.sequence <= (state.clients.get(order.client) ?? 0)) return new Response(null, { status: 204 });
    state.clients.set(order.client, order.sequence);
    const ticket = ++state.request;
    // Existing HTTP field names map to the canonical Diff endpoints model.
    const requestedEndpoints = { target: data.get("end"), base: data.has("start") ? data.get("start") === "" ? null : data.get("start") : undefined };
    let next: ChangesSnapshot;
    try {
      if (!Value.Check(diffEndpointsSchema, requestedEndpoints)) throw new InvalidDiffEndpoints("Invalid comparison endpoints.");
      const endpoints: DiffEndpoints = requestedEndpoints;
      const root = workspaceRepository(workspaceId);
      if (match[1] === "compare") next = await captureChanges(root, endpoints, previous.history);
      else next = await refreshChanges(root, previous, endpoints);
    } catch (error) {
      if (!(error instanceof InvalidDiffEndpoints)) throw error;
      if (ticket !== state.request) return new Response(null, { status: 204 });
      return turboStreamResponse(replace(errorId(workspaceId, previous.history.id), renderError(workspaceId, previous.history.id, error.message)), { status: 422 });
    }
    // Last request wins. A slow earlier capture must not publish or overwrite a newer selection.
    if (ticket !== state.request) return new Response(null, { status: 204 });
    state.snapshot = next;
    invalidateWorkspace(workspaceId);
    if (match[1] === "refresh") {
      state.clients.clear();
      return turboStreamResponse(replace(changesBodyId(workspaceId, previous.history.id), renderChanges(workspaceId, next, data.get("pickerOpen") === "true")));
    }
    return turboStreamResponse(replace(comparisonId(workspaceId, previous.history.id), renderComparison(workspaceId, next, true)) + replace(errorId(workspaceId, previous.history.id), renderError(workspaceId, previous.history.id)));
  } }],
  initialize(context) {
    invalidateWorkspace = context.invalidateWorkspace;
    context.events.on("workspace_agent_turn_finished", async ({ workspaceId }) => {
      const state = await current(workspaceId);
      const ticket = ++state.request;
      const next = await refreshChanges(workspaceRepository(workspaceId), state.snapshot);
      // A later user selection owns the comparison; don't overwrite it with this capture.
      if (ticket !== state.request || !states.has(workspaceId)) return;
      state.snapshot = next;
      state.clients.clear();
      invalidateWorkspace(workspaceId);
    });
    context.events.on("workspace_delete_inspect", ({ workspaceId, issues }) => {
      const uncopied = reviewComments.list(workspaceId).filter(comment => comment.copiedRevision !== comment.revision);
      if (uncopied.length) issues.push({ kind: "uncopied_review_comments", message: `${uncopied.length} review comments haven’t been copied. Deleting this workspace will delete them.`, count: uncopied.length });
    });
    context.onWorkspaceRemoved(workspaceId => { states.delete(workspaceId); clearDeletionReview(workspaceId); reviewComments.delete(workspaceId); });
  },
  async attachToWorkspace({ workspaceId }) {
    const { snapshot } = await current(workspaceId);
    return {
      workViews: [{ reference, sourceKey: "changes:workspace", label: renderChangesTitle(snapshot), kind: "contextual", iconHtml: Icons.Changes, availability: { phase: "live" }, initiallyOpen: false }],
      commands: [{ id: "changes.open", label: "Changes", description: "Compare local commits and uncommitted changes.", scope: "workspace", surfaces: { ui: { placement: "work-launcher", iconHtml: Icons.Changes, label: "Changes" }, shortcut: { defaultBinding: "Meta+Alt+KeyC" } } }],
    };
  },
};
