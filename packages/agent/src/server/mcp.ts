import type { AtelierEventBus } from "@atelier/core";
import { execWorkspaceShell } from "@atelier/workspace";
import { authenticateAgentRequest, createAgentMcpCredentials } from "./mcp-credentials.ts";
import { createAgentMcpServer } from "./mcp-server.ts";
import { createAtelierControlTools } from "./tools.ts";
import { agentConversationKey } from "./render-context.ts";
import { publishWorkspaceAgentBusy } from "./workspace-agent-busy.ts";
import { prepareAppendedAtelierInstructions, sharedAtelierInstructions } from "./system-prompt.ts";

async function agentMcpInstructions(workspaceId: string, agentId: string): Promise<string> {
  return [sharedAtelierInstructions, ...await prepareAppendedAtelierInstructions(events, workspaceId, agentId)].join("\n\n");
}

let credentials: ReturnType<typeof createAgentMcpCredentials> | undefined;
function credentialStore() { return credentials ??= createAgentMcpCredentials(); }
let events: AtelierEventBus | undefined;
const mcp = createAgentMcpServer({
  authenticate: (token) => credentialStore().authenticate(token),
  tools: ({ workspaceId }) => createAtelierControlTools(workspaceId, { events }),
  instructions: ({ workspaceId, agentId }) => agentMcpInstructions(workspaceId, agentId),
});
export function configureAgentMcp(eventBus: AtelierEventBus): void {
  events = eventBus;
  eventBus.on("workspace_deleting", async ({ workspaceId }) => {
    credentialStore().revokeWorkspace(workspaceId);
    await mcp.revoke({ workspaceId });
  });
}
export function handleAgentMcpRequest(request: Request, workspaceId?: string): Promise<Response> | undefined {
  const path = new URL(request.url).pathname;
  if (path === "/mcp") return mcp.fetch(request, workspaceId);
  if (path === "/agent-turn-started") return handleTurnBoundary(request, workspaceId, true);
  if (path === "/agent-turn-finished") return handleTurnBoundary(request, workspaceId, false);
}

export async function revokeAgentMcp(workspaceId: string, agentId: string): Promise<void> {
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
    nohup socat TCP4-LISTEN:2988,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/run/atelier-parent/ingress.sock > /tmp/atelier-mcp.log 2>&1 < /dev/null 9>&- &
  fi
) 9>/tmp/atelier-mcp.lock
for attempt in $(seq 1 50); do
  if curl --noproxy '*' --max-time 2 --silent http://127.0.0.1:2988/health | grep -qx ok; then exit 0; fi
  sleep .1
done
cat /tmp/atelier-mcp.log >&2
exit 1`);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Could not start workspace MCP relay");
  return { url: "http://127.0.0.1:2988/mcp", token: credentialStore().issue({ workspaceId, agentId }) };
}

/** CLI agents run outside Atelier's runtime, so their turn boundaries arrive as authenticated loopback requests. */
async function handleTurnBoundary(request: Request, workspaceId: string | undefined, started: boolean): Promise<Response> {
  const identity = authenticateAgentRequest(request, credentialStore().authenticate, workspaceId);
  if (identity instanceof Response) return identity;
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  publishWorkspaceAgentBusy({ workspaceId: identity.workspaceId, agentKey: agentConversationKey(identity.agentId), busy: started });
  if (!started) await events!.emit("workspace_agent_turn_finished", { workspaceId: identity.workspaceId, conversationId: identity.agentId });
  return new Response(null, { status: 204 });
}
