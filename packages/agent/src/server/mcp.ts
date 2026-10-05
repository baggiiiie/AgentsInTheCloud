import type { AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import { execWorkspaceShell } from "@agents-in-the-cloud/workspace";
import { authenticateAgentRequest, createAgentMcpCredentials, type AgentMcpIdentity } from "./mcp-credentials.ts";
import { createAgentMcpServer } from "./mcp-server.ts";
import { createAgentsInTheCloudControlTools } from "./tools.ts";
import { agentConversationKey } from "./render-context.ts";
import { publishWorkspaceAgentBusy } from "./workspace-agent-busy.ts";
import { prepareAppendedAgentsInTheCloudInstructions, sharedAgentsInTheCloudInstructions } from "./system-prompt.ts";

async function agentMcpInstructions(workspaceId: string, agentId: string): Promise<string> {
  return [sharedAgentsInTheCloudInstructions, ...await prepareAppendedAgentsInTheCloudInstructions(events, workspaceId, agentId)].join("\n\n");
}

let credentials: ReturnType<typeof createAgentMcpCredentials> | undefined;
function credentialStore() { return credentials ??= createAgentMcpCredentials(); }
let events: AgentsInTheCloudEventBus | undefined;
const mcp = createAgentMcpServer({
  authenticate: (token) => credentialStore().authenticate(token),
  tools: ({ workspaceId }) => createAgentsInTheCloudControlTools(workspaceId, { events }),
  instructions: ({ workspaceId, agentId }) => agentMcpInstructions(workspaceId, agentId),
});
export type AgentTurnFinishReason = "stop" | "stopFailure";
/** Resolves once the agent's own record of its finished turn is complete; other agents resolve at once. */
type TurnSettler = (workspaceId: string, agentId: string, signal: AbortSignal, reason: AgentTurnFinishReason) => Promise<void>;
const turnSettlers = new Set<TurnSettler>();
// Agent IDs name conversations, which are unique across workspaces.
const settlingTurns = new Map<string, AbortController>();

export function configureAgentMcp(eventBus: AgentsInTheCloudEventBus): void {
  events = eventBus;
  eventBus.on("workspace_deleting", async ({ workspaceId }) => {
    credentialStore().revokeWorkspace(workspaceId);
    await mcp.revoke({ workspaceId });
  });
}
/** Every finished turn waits for all settlers, including turns of sessions restored after a restart. */
export function registerAgentTurnSettler(settler: TurnSettler): void {
  turnSettlers.add(settler);
}

export function handleAgentMcpRequest(request: Request, workspaceId?: string): Promise<Response> | undefined {
  const path = new URL(request.url).pathname;
  if (path === "/mcp") return mcp.fetch(request, workspaceId);
  if (path === "/agent-turn-started") return handleTurnBoundary(request, workspaceId, true);
  if (path === "/agent-turn-finished") return handleTurnBoundary(request, workspaceId, false, "stop");
  if (path === "/agent-turn-failed") return handleTurnBoundary(request, workspaceId, false, "stopFailure");
}

function abandonSettlingTurn(agentId: string): void {
  settlingTurns.get(agentId)?.abort();
  settlingTurns.delete(agentId);
}

export async function revokeAgentMcp(workspaceId: string, agentId: string): Promise<void> {
  abandonSettlingTurn(agentId);
  credentialStore().revoke({ workspaceId, agentId });
  await mcp.revoke({ workspaceId, agentId });
}

/** Start the workspace relay; the CLI owns writing credentials into its private configuration. */
export async function prepareAgentMcp(workspaceId: string, agentId: string) {
  const result = await execWorkspaceShell(workspaceId, `set -eu
# One loopback HTTP listener per workspace; parent Unix sockets survive host restarts.
(
  flock 9
  if ! curl --noproxy '*' --max-time 2 --silent http://127.0.0.1:2988/health | grep -qx ok; then
    nohup socat TCP4-LISTEN:2988,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/run/agents-in-the-cloud-parent/ingress.sock > /tmp/agents-in-the-cloud-mcp.log 2>&1 < /dev/null 9>&- &
  fi
) 9>/tmp/agents-in-the-cloud-mcp.lock
for attempt in $(seq 1 50); do
  if curl --noproxy '*' --max-time 2 --silent http://127.0.0.1:2988/health | grep -qx ok; then exit 0; fi
  sleep .1
done
cat /tmp/agents-in-the-cloud-mcp.log >&2
exit 1`);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Could not start workspace MCP relay");
  return { url: "http://127.0.0.1:2988/mcp", token: credentialStore().issue({ workspaceId, agentId }) };
}

/** CLI agents run outside AgentsInTheCloud's runtime, so their turn boundaries arrive as authenticated loopback requests. */
async function handleTurnBoundary(request: Request, workspaceId: string | undefined, started: boolean, reason: AgentTurnFinishReason = "stop"): Promise<Response> {
  const identity = authenticateAgentRequest(request, credentialStore().authenticate, workspaceId);
  if (identity instanceof Response) return identity;
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  abandonSettlingTurn(identity.agentId);
  if (started) {
    publishWorkspaceAgentBusy({ workspaceId: identity.workspaceId, agentKey: agentConversationKey(identity.agentId), busy: true });
  } else {
    // The finished signal can precede the CLI's last history writes, and Claude only makes
    // some of them after this request returns. Answer now; end the turn once it has settled.
    const settling = new AbortController();
    settlingTurns.set(identity.agentId, settling);
    void finishTurn(identity, settling.signal, reason).catch((error) => {
      console.error(`Could not finish the turn of agent ${identity.agentId}`, error);
    });
  }
  return new Response(null, { status: 204 });
}

async function finishTurn({ workspaceId, agentId }: AgentMcpIdentity, signal: AbortSignal, reason: AgentTurnFinishReason): Promise<void> {
  await Promise.all([...turnSettlers].map((settle) => settle(workspaceId, agentId, signal, reason)));
  // A newer turn boundary or revocation owns the busy state now.
  if (signal.aborted) return;
  settlingTurns.delete(agentId);
  publishWorkspaceAgentBusy({ workspaceId, agentKey: agentConversationKey(agentId), busy: false });
  await events!.emit("workspace_agent_turn_finished", { workspaceId, conversationId: agentId });
}
