import type { JsonValue } from "@agents-in-the-cloud/core";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { turboStreamResponse, type WorkspaceModule } from "@agents-in-the-cloud/shared";
import { matchRoute, response, textResponse } from "@agents-in-the-cloud/shared/http";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { isReviewDiffHighlighting, isReviewDiffOverflow, reviewCommentsPrompt, type ReviewSide } from "../model.ts";
import { clearDeletionReview, deletionReviewCommitResponse, deletionReviewFileResponse, reviewDeletionReview } from "./deletion.ts";
import { collectReviewFile, collectReviewIndex, collectReviewStats, reviewSnippet, type ReviewFileStats, type ReviewIndex } from "./diff.ts";
import { workspaceRepository } from "@agents-in-the-cloud/workspace/git";
import { renderReviewBody, renderReviewFileContent, renderReviewFilePage, renderReviewMoreFiles, renderReviewTitle, reviewFileFrameId, reviewFilePageSize, reviewPageId, reviewReference, reviewWorkViewPresentation } from "./render.ts";
import {
  isReviewDiffLayout,
  isReviewViewport,
  readReviewSettings,
  updateReviewSettings,
} from "./settings.ts";
import { addReviewComment, deleteReviewComments, deleteReviewState, listReviewComments, reconcileReviewComments, remapReviewFileComments, reviewCommentsForPrompt, updateReviewComment, type ReviewComment } from "./state.ts";

const reviewReferenceSchema = Type.Object({ type: Type.Literal("review") });
type ReviewReference = Static<typeof reviewReferenceSchema>;
let invalidateWorkspace: (workspaceId: string) => void;
const indexes = new Map<string, ReviewIndex>();
const stats = new WeakMap<ReviewIndex, Promise<ReviewFileStats[]>>();

async function refresh(workspaceId: string): Promise<{ index: ReviewIndex; comments: ReviewComment[] }> {
  const index = await collectReviewIndex(workspaceRepository(workspaceId));
  indexes.set(workspaceId, index);
  return { index, comments: reconcileReviewComments(workspaceId, index) };
}

async function current(workspaceId: string): Promise<{ index: ReviewIndex; comments: ReviewComment[] }> {
  const index = indexes.get(workspaceId);
  return index ? { index, comments: listReviewComments(workspaceId) } : await refresh(workspaceId);
}

function currentStats(workspaceId: string, index: ReviewIndex): Promise<ReviewFileStats[]> {
  let pending = stats.get(index);
  if (!pending) {
    pending = collectReviewStats(workspaceRepository(workspaceId), index);
    stats.set(index, pending);
    void pending.catch(() => stats.delete(index));
  }
  return pending;
}

async function refreshedResponse(workspaceId: string): Promise<Response> {
  await refresh(workspaceId);
  return turboStreamResponse("");
}

function positiveLine(value: FormDataEntryValue | null): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function createComment(workspaceId: string, request: Request): Promise<Response> {
  const form = await request.formData();
  const path = String(form.get("path") ?? "");
  const sideValue = String(form.get("side") ?? "");
  const side: ReviewSide | undefined = sideValue === "deletions" || sideValue === "additions" ? sideValue : undefined;
  const startLine = positiveLine(form.get("startLine"));
  const endLine = positiveLine(form.get("endLine"));
  const body = String(form.get("body") ?? "").trim();
  if (!path || !side || !startLine || !endLine || endLine < startLine || !body || body.length > 20_000) return textResponse("Invalid review comment", { status: 422 });
  const file = await collectReviewFile(workspaceRepository(workspaceId), path);
  if (!file || file.kind !== "text") return textResponse("Review file is no longer available", { status: 409 });
  const snippet = reviewSnippet(file, side, startLine, endLine);
  if (!snippet && startLine !== 1) return textResponse("Review line is no longer available", { status: 409 });
  addReviewComment(workspaceId, { path, side, startLine, endLine, body, snippet });
  return turboStreamResponse("");
}

async function updateComment(workspaceId: string, id: string, request: Request): Promise<Response> {
  const body = String((await request.formData()).get("body") ?? "").trim();
  if (!body || body.length > 20_000) return textResponse("Invalid review comment", { status: 422 });
  const comment = listReviewComments(workspaceId).find((candidate) => candidate.id === id);
  if (!comment) return textResponse("Review comment not found", { status: 404 });
  const file = await collectReviewFile(workspaceRepository(workspaceId), comment.path);
  if (!file || file.kind !== "text") return textResponse("Review file is no longer available", { status: 409 });
  updateReviewComment(workspaceId, id, body);
  return turboStreamResponse("");
}

export const reviewWorkspaceModule: WorkspaceModule = {
  id: "review",
  liveSurfaces: [{ name: "review-file", async load({ workspaceId, key }) {
    const file = await collectReviewFile(workspaceRepository(workspaceId), key);
    if (!file) return [{ target: reviewFileFrameId(workspaceId, key), html: '<p role="note">This change is no longer available.</p>' }];
    const { comments, changed } = remapReviewFileComments(workspaceId, file);
    if (changed) invalidateWorkspace(workspaceId);
    return [{ target: reviewFileFrameId(workspaceId, key), html: await renderReviewFileContent(workspaceId, file, comments) }];
  } }, { name: "review-page", async load({ workspaceId, key }) {
    const offset = Number(key);
    if (!Number.isSafeInteger(offset) || offset < reviewFilePageSize || offset % reviewFilePageSize !== 0) throw new Error("Invalid review file offset");
    const { index, comments } = await current(workspaceId);
    const files = await currentStats(workspaceId, index);
    return [{ target: reviewPageId(workspaceId, offset), html: renderReviewFilePage(workspaceId, index, comments, offset, files) }];
  } }],
  deletionReview: reviewDeletionReview,
  workViews: [{
    type: "review",
    parseReference(value: JsonValue) {
      if (!Value.Check(reviewReferenceSchema, value)) throw new Error("Review reference is invalid");
      return { type: value.type };
    },
    identity: (_reference: ReviewReference) => "workspace",
    async render({ workspaceId }) {
      const { index, comments } = await current(workspaceId);
      const files = await currentStats(workspaceId, index);
      return renderReviewBody(workspaceId, index, comments, await readReviewSettings(), files);
    },
  }],
  commands: [{ id: "review.open", execute: () => ({ createdWorkView: reviewReference }) }],
  staticFiles: { "/review.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" } },
  routes: [{
    async handle(request, url) {
      if (url.pathname.startsWith("/review/settings/")) {
        if (request.method !== "POST") return textResponse("Method not allowed", { status: 405 });
        const form = await request.formData();
        if (url.pathname === "/review/settings/diff-layout") {
          const viewport = url.searchParams.get("viewport") ?? "";
          const value = String(form.get("review-diff-layout") ?? "");
          if (!isReviewViewport(viewport) || !isReviewDiffLayout(value)) return textResponse("Invalid review diff layout", { status: 422 });
          await updateReviewSettings({ [viewport]: value });
        } else if (url.pathname === "/review/settings/diff-highlighting") {
          const value = String(form.get("review-diff-highlighting") ?? "");
          if (!isReviewDiffHighlighting(value)) return textResponse("Invalid review diff highlighting", { status: 422 });
          await updateReviewSettings({ highlighting: value });
        } else if (url.pathname === "/review/settings/diff-overflow") {
          const value = String(form.get("review-diff-overflow") ?? "");
          if (!isReviewDiffOverflow(value)) return textResponse("Invalid review diff overflow", { status: 422 });
          await updateReviewSettings({ overflow: value });
        } else {
          return textResponse("Not found", { status: 404 });
        }
        return turboStreamResponse("");
      }
      let match = matchRoute(url, /^\/workspaces\/([^/]+)\/review\/deletion\/file$/);
      if (match) return request.method === "GET" ? await deletionReviewFileResponse(match[0]!, url) : textResponse("Method not allowed", { status: 405 });
      match = matchRoute(url, /^\/workspaces\/([^/]+)\/review\/deletion\/commit$/);
      if (match) return request.method === "GET" ? await deletionReviewCommitResponse(match[0]!, url) : textResponse("Method not allowed", { status: 405 });
      match = matchRoute(url, /^\/workspaces\/([^/]+)\/review\/refresh$/);
      if (match) return request.method === "POST" ? await refreshedResponse(match[0]!) : textResponse("Method not allowed", { status: 405 });
      match = matchRoute(url, /^\/workspaces\/([^/]+)\/review\/more-files$/);
      if (match) {
        if (request.method !== "GET") return textResponse("Method not allowed", { status: 405 });
        const workspaceId = match[0]!;
        const offset = Number(url.searchParams.get("offset"));
        if (!Number.isSafeInteger(offset) || offset < reviewFilePageSize || offset % reviewFilePageSize !== 0) return textResponse("Invalid review file offset", { status: 422 });
        const { index, comments } = await current(workspaceId);
        const files = await currentStats(workspaceId, index);
        return response(renderReviewMoreFiles(workspaceId, index, comments, offset, files));
      }
      match = matchRoute(url, /^\/workspaces\/([^/]+)\/review\/comments$/);
      if (match) return request.method === "POST" ? await createComment(match[0]!, request) : textResponse("Method not allowed", { status: 405 });
      match = matchRoute(url, /^\/workspaces\/([^/]+)\/review\/comments\/delete$/);
      if (match) {
        if (request.method !== "POST") return textResponse("Method not allowed", { status: 405 });
        const workspaceId = match[0]!;
        const { comments } = await current(workspaceId);
        deleteReviewComments(workspaceId, comments.map((comment) => comment.id));
        return turboStreamResponse("");
      }
      match = matchRoute(url, /^\/workspaces\/([^/]+)\/review\/comments\/([^/]+)\/update$/);
      if (match) return request.method === "POST" ? await updateComment(match[0]!, match[1]!, request) : textResponse("Method not allowed", { status: 405 });
      match = matchRoute(url, /^\/workspaces\/([^/]+)\/review\/comments\/([^/]+)\/delete$/);
      if (!match) return undefined;
      if (request.method !== "POST") return textResponse("Method not allowed", { status: 405 });
      const workspaceId = match[0]!;
      const id = match[1]!;
      const comment = listReviewComments(workspaceId).find((candidate) => candidate.id === id);
      if (!comment) return textResponse("Review comment not found", { status: 404 });
      deleteReviewComments(workspaceId, [id]);
      return turboStreamResponse("");
    },
  }],
  initialize(context) {
    invalidateWorkspace = context.invalidateWorkspace;
    context.events.on("workspace_agent_turn_finished", async ({ workspaceId }) => {
      await refresh(workspaceId);
      context.invalidateWorkspace(workspaceId);
    });
    context.events.on("workspace_agent_prompt_preparing", (event) => {
      const section = reviewCommentsPrompt(reviewCommentsForPrompt(event.workspaceId, event.reviewCommentIds));
      if (section) event.sections.push(section);
    });
    context.events.on("workspace_agent_prompt_submitted", ({ workspaceId, reviewCommentIds }) => {
      deleteReviewComments(workspaceId, reviewCommentIds);
      context.invalidateWorkspace(workspaceId);
    });
    context.onWorkspaceRemoved((workspaceId) => {
      indexes.delete(workspaceId);
      deleteReviewState(workspaceId);
      clearDeletionReview(workspaceId);
    });
  },
  async attachToWorkspace({ workspaceId }) {
    const { index } = await current(workspaceId);
    const files = await currentStats(workspaceId, index);
    const workView = { ...reviewWorkViewPresentation, label: index.phase === "ready" ? renderReviewTitle(files) : reviewWorkViewPresentation.label };
    return {
      workViews: [workView],
      commands: [{ id: "review.open", label: "Review", description: "Open Review to see and comment on the workspace's changes.", scope: "workspace", surfaces: { ui: { placement: "work-launcher", iconHtml: Icons.Review, label: "Review" }, shortcut: { defaultBinding: "Meta+Alt+KeyR" } } }],
    };
  },
};

export { reviewWorkspaceModule as agentsInTheCloudServerModule };
