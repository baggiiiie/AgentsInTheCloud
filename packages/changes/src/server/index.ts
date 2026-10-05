import type { JsonValue } from "@agents-in-the-cloud/core";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { escapeHtml, turboStreamResponse, type WorkspaceModule } from "@agents-in-the-cloud/shared";
import { matchRoute, response, textResponse } from "@agents-in-the-cloud/shared/http";
import { workspaceWorkHostPath } from "@agents-in-the-cloud/workspace";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { changesBodyId, renderChanges, renderChangesFile } from "./render.ts";
import { captureChanges, type ChangesSnapshot } from "./snapshot.ts";

const reference = { type: "changes" } as const;
const referenceSchema = Type.Object({ type: Type.Literal("changes") });
const snapshots = new Map<string, Promise<ChangesSnapshot>>();

function current(workspaceId: string): Promise<ChangesSnapshot> {
  let snapshot = snapshots.get(workspaceId);
  if (!snapshot) {
    snapshot = captureChanges(workspaceWorkHostPath(workspaceId));
    snapshots.set(workspaceId, snapshot);
    void snapshot.catch(() => { if (snapshots.get(workspaceId) === snapshot) snapshots.delete(workspaceId); });
  }
  return snapshot;
}

export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "changes",
  workViews: [{
    type: "changes",
    parseReference(value: JsonValue) {
      if (!Value.Check(referenceSchema, value)) throw new Error("Changes reference is invalid");
      return reference;
    },
    identity: () => "workspace",
    async render({ workspaceId }) { return renderChanges(workspaceId, await current(workspaceId)); },
  }],
  commands: [{ id: "changes.open", execute: () => ({ createdWorkView: reference }) }],
  staticFiles: { "/changes.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" } },
  routes: [{ async handle(request, url) {
    let match = matchRoute(url, /^\/workspaces\/([^/]+)\/changes\/file$/);
    if (match) {
      if (request.method !== "GET") return textResponse("Method not allowed", { status: 405 });
      const snapshot = await current(match[0]!);
      if (url.searchParams.get("snapshot") !== snapshot.id) return textResponse("This comparison was refreshed. Reopen Changes to load the current snapshot.", { status: 409 });
      const file = snapshot.files.get(url.searchParams.get("path") ?? "");
      return file ? response(renderChangesFile(file, snapshot.id)) : textResponse("Changed file not found", { status: 404 });
    }
    match = matchRoute(url, /^\/workspaces\/([^/]+)\/changes\/refresh$/);
    if (!match) return undefined;
    if (request.method !== "POST") return textResponse("Method not allowed", { status: 405 });
    const workspaceId = match[0]!;
    const previous = await current(workspaceId);
    if (url.searchParams.get("snapshot") !== previous.id) return textResponse("This comparison has already been refreshed.", { status: 409 });
    snapshots.delete(workspaceId);
    const html = renderChanges(workspaceId, await current(workspaceId));
    return turboStreamResponse(`<turbo-stream action="replace" target="${escapeHtml(changesBodyId(workspaceId, previous.id))}"><template>${html}</template></turbo-stream>`);
  } }],
  initialize(context) { context.onWorkspaceRemoved((workspaceId) => { snapshots.delete(workspaceId); }); },
  attachToWorkspace() {
    return {
      workViews: [{ reference, sourceKey: "changes:workspace", label: "Changes", kind: "contextual", iconHtml: Icons.Review, availability: { phase: "live" }, initiallyOpen: false }],
      commands: [{ id: "changes.open", label: "Changes", description: "Open the workspace’s uncommitted changes.", scope: "workspace", surfaces: { ui: { placement: "work-launcher", iconHtml: Icons.Review, label: "Changes" } } }],
    };
  },
};
