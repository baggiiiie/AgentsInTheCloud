import { refreshChanges } from "./refresh.ts";
import type { JsonValue } from "@agents-in-the-cloud/core";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { escapeHtml, turboStreamResponse, type WorkspaceModule } from "@agents-in-the-cloud/shared";
import { matchRoute, response, textResponse } from "@agents-in-the-cloud/shared/http";
import { workspaceRepository } from "@agents-in-the-cloud/workspace/git";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { changesBodyId, comparisonId, errorId, historyContentId, renderChanges, renderChangesTitle, renderChangesFile, renderComparison, renderError, renderHistory } from "./render.ts";
import type { ChangesRange } from "../history.ts";
import { captureChanges, commitHistory, InvalidChangesRange, type ChangesSnapshot } from "./snapshot.ts";

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
const rangeSchema = Type.Object({ newest: Type.String(), oldest: Type.String(), unpushed: Type.Optional(Type.Literal(true)) });
const requestSchema = Type.Object({ client: Type.String({ minLength: 1, maxLength: 64 }), sequence: Type.Integer({ minimum: 1 }) });

export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "changes",
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
  staticFiles: { "/changes.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" } },
  routes: [{ async handle(request, url) {
    let match = matchRoute(url, /^\/workspaces\/([^/]+)\/changes\/file$/);
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
      return turboStreamResponse(replace(historyContentId(history), renderHistory(workspaceId, state.snapshot)));
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
    const requestedRange = { newest: data.get("newest"), oldest: data.get("oldest"), unpushed: data.get("unpushed") === "true" ? true as const : undefined };
    let next: ChangesSnapshot;
    try {
      if (!Value.Check(rangeSchema, requestedRange)) throw new InvalidChangesRange("Invalid comparison endpoints.");
      const range: ChangesRange = requestedRange;
      const root = workspaceRepository(workspaceId);
      if (match[1] === "compare") next = await captureChanges(root, range, previous.history);
      else next = await refreshChanges(root, previous, range);
    } catch (error) {
      if (!(error instanceof InvalidChangesRange)) throw error;
      if (ticket !== state.request) return new Response(null, { status: 204 });
      return turboStreamResponse(replace(errorId(workspaceId, previous.history.id), renderError(workspaceId, previous.history.id, error.message)), { status: 422 });
    }
    // Last request wins. A slow earlier capture must not publish or overwrite a newer selection.
    if (ticket !== state.request) return new Response(null, { status: 204 });
    state.snapshot = next;
    invalidateWorkspace(workspaceId);
    if (match[1] === "refresh") state.clients.clear();
    if (match[1] === "refresh") return turboStreamResponse(replace(changesBodyId(workspaceId, previous.history.id), renderChanges(workspaceId, next, data.get("pickerOpen") === "true")));
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
    context.onWorkspaceRemoved(workspaceId => { states.delete(workspaceId); });
  },
  async attachToWorkspace({ workspaceId }) {
    const { snapshot } = await current(workspaceId);
    return {
      workViews: [{ reference, sourceKey: "changes:workspace", label: renderChangesTitle(snapshot), kind: "contextual", iconHtml: Icons.Review, availability: { phase: "live" }, initiallyOpen: false }],
      commands: [{ id: "changes.open", label: "Changes", description: "Compare local commits and uncommitted changes.", scope: "workspace", surfaces: { ui: { placement: "work-launcher", iconHtml: Icons.Review, label: "Changes" } } }],
    };
  },
};
