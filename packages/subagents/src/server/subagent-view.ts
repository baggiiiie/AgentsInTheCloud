import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { disclosureHtml } from "@agents-in-the-cloud/design-system/disclosure";
import type { AgentLivePresentationSubscription, AgentRouteHandler } from "@agents-in-the-cloud/builtin-agent/server";
import { ids } from "@agents-in-the-cloud/agent/server";
import { listWorkspaceAgents } from "@agents-in-the-cloud/builtin-agent/server";
import { requestAcceptsJson, type JsonValue } from "@agents-in-the-cloud/core";
import type { DisclosureSummary } from "@agents-in-the-cloud/design-system/disclosure";
import type { WorkspaceModuleWorkViewAdapter, WorkspaceWorkViewPresentation } from "@agents-in-the-cloud/shared";
import { createLivePresentation, escapeHtml as h } from "@agents-in-the-cloud/shared";
import { response } from "@agents-in-the-cloud/shared/http";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { nativeSnapshot, viewPath, type NativeSubagentView as SubagentRecord } from "./native-view-state.ts";
import { durableWorkspaceOwner, WorkspaceAgents } from "@agents-in-the-cloud/builtin-agent/server";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Delegation } from "./native-state.ts";

export const subagentsWorkView: WorkspaceWorkViewPresentation = {
  reference: { type: "subagents" }, sourceKey: "subagents", label: "Subagents", kind: "contextual", iconHtml: Icons.Subagents, availability: { phase: "live" }, initiallyOpen: false,
};
export const subagentsWorkViewAdapter: WorkspaceModuleWorkViewAdapter = {
  type: "subagents",
  parseReference(value: JsonValue) {
    if (!Value.Check(Type.Object({ type: Type.Literal("subagents") }), value)) throw new Error("Invalid Subagents reference");
    return { type: "subagents" };
  },
  identity: () => "workspace",
  render({ workspaceId }) {
    return `<section class="subagents-view" data-controller="subagents" data-subagents-workspace-id-value="${h(workspaceId)}" data-action="agents-in-the-cloud:workspace-agent-selected@document->subagents#sync agents-in-the-cloud:workspace-pane-visible@document->subagents#sync agents-in-the-cloud:workspace-pane-hidden@document->subagents#sync visibilitychange@document->subagents#sync agent:turn-reveal->subagents#loaded toggle->subagents#toggle:capture">
      <div class="subagents-scroll"><div id="subagents-content-${h(workspaceId)}" data-turbo-permanent></div></div>
    </section>`;
  },
};

export const handleSubagentRequest: AgentRouteHandler = async (request, url) => {
  const match = url.pathname.match(/^\/workspaces\/([^/]+)\/subagents$/);
  if (!match || request.method !== "GET") return undefined;
  const workspaceId = decodeURIComponent(match[1]!);
  const roots = await listWorkspaceAgents(workspaceId);
  const parentId = url.searchParams.get("agent") ?? roots[0]?.agentId;
  const parent = roots.find((agent) => agent.agentId === parentId);
  if (!parent) return new Response("Agent not found", { status: 404 });
  const snapshot = await nativeSnapshot(workspaceId);
  const agents = snapshot.agents.filter(agent => agent.rootId === parent.agentId);
  if (requestAcceptsJson(request)) return Response.json({ parent: { id: parentId, title: parent.title }, agents, messages: snapshot.messages.filter((message) => message.to === parentId || message.from === parentId || agents.some((agent) => agent.id === message.to || agent.id === message.from)) });
  const open = new Set(url.searchParams.getAll("open"));
  let revealed = agents.find((agent) => agent.id === url.searchParams.get("reveal"));
  while (revealed) { open.add(revealed.id); revealed = agents.find((agent) => agent.id === revealed!.parentId); }
  return response(`<turbo-frame id="subagents-content-${h(workspaceId)}" data-turbo-permanent refresh="morph">${renderSubagentTree(workspaceId, parent.agentId, agents, open)}</turbo-frame>`);
};

function childrenId(workspaceId: string, parentId: string): string { return `subagent-children-${workspaceId}-${parentId}`; }
function branchSummary(agent: SubagentRecord, agents: SubagentRecord[]): DisclosureSummary {
  const tone = agent.status === "running" || agent.status === "pending" ? "running" : agent.status === "failed" ? "danger" : agent.status === "completed" ? "success" : "";
  return { kind: "multiline", attributesHtml: `id="subagent-summary-${h(agent.id)}"`, label: { kind: "text", text: viewPath(agents, agent.id) }, trailingHtml: `<span class="subagent-state"><span class="status-dot ${tone}"></span>${h(agent.status)}</span>` };
}
function branchHtml(workspaceId: string, agent: SubagentRecord, agents: SubagentRecord[], open: Set<string>): string {
  return `<div class="subagent-branch">${disclosureHtml({
    element: { id: `subagent-${agent.id}`, attributesHtml: `data-subagent-id="${h(agent.id)}" data-subagents-target="branch"` },
    summary: branchSummary(agent, agents), open: open.has(agent.id),
    bodyHtml: `<div id="${ids.transcript({ workspaceId, agentId: agent.id })}" class="agent-transcript" data-turbo-permanent></div>${childrenHtml(workspaceId, agent.id, agents, open)}`,
  })}</div>`;
}
function childrenHtml(workspaceId: string, parentId: string, agents: SubagentRecord[], open: Set<string>): string {
  return `<div id="${h(childrenId(workspaceId, parentId))}" class="action-list subagent-list">${agents.filter((agent) => agent.parentId === parentId).map((agent) => branchHtml(workspaceId, agent, agents, open)).join("")}</div>`;
}
function emptyHtml(workspaceId: string, empty: boolean): string {
  return `<div id="subagents-empty-${h(workspaceId)}" class="subagents-empty"${empty ? "" : " hidden"}>No subagents for this Agent yet.</div>`;
}
function unsupportedHtml(workspaceId: string): string {
  return `<div id="subagents-unsupported-${h(workspaceId)}" class="subagents-empty">This Subagents view only works with the Builtin agent.</div>`;
}
function renderSubagentTree(workspaceId: string, rootId: string, agents: SubagentRecord[], open = new Set<string>()): string {
  return childrenHtml(workspaceId, rootId, agents, open) + emptyHtml(workspaceId, agents.length === 0);
}

/** Publish the tree while preserving independently subscribed child transcripts. */
export async function subscribeSubagentTree(workspaceId: string, rootId: string, listener: (html: string) => void): Promise<AgentLivePresentationSubscription> {
  const roots = await listWorkspaceAgents(workspaceId);
  if (!roots.some((root) => root.agentId === rootId)) {
    const presentation = createLivePresentation(() => [{
      target: `subagents-content-${workspaceId}`,
      html: unsupportedHtml(workspaceId),
    }]);
    const subscription = presentation.subscribe(listener);
    return { unsubscribe() { subscription.unsubscribe(); presentation.dispose(); } };
  }
  const owner = await durableWorkspaceOwner(workspaceId);
  let snapshot = await nativeSnapshot(workspaceId);
  const presentation = createLivePresentation(() => [{
    target: `subagents-content-${workspaceId}`,
    html: renderSubagentTree(workspaceId, rootId, snapshot.agents.filter(agent => agent.rootId === rootId)),
  }]);
  const watches = await Promise.all([
    owner.harness.watchDoc(WorkspaceAgents, BACKGROUND_CONTEXT),
    owner.harness.watchDoc(Delegation, BACKGROUND_CONTEXT),
    owner.harness.watchTaskGraph(BACKGROUND_CONTEXT),
  ]);
  let updates = Promise.resolve();
  const refresh = () => updates = updates.then(async () => { snapshot = await nativeSnapshot(workspaceId); presentation.invalidate(); });
  for (const watch of watches) watch?.start(refresh);
  await refresh();

  const subscription = presentation.subscribe(listener);
  return { unsubscribe() { for (const watch of watches) void watch?.stop(); subscription.unsubscribe(); presentation.dispose(); } };
}
