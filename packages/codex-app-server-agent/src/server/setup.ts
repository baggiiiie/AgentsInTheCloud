import { agentsInTheCloudSystemPrompt } from "@agents-in-the-cloud/agent/server/system-prompt";
import { prepareCliAgentConnection } from "@agents-in-the-cloud/agent/server";
import { checkedWorkspaceShell, cliLaunchScript, createCliModelSettings } from "@agents-in-the-cloud/cli-agent/server";
import { createPiModelRuntime, installCodexSubscriptionAuth, requireProviderSubscription } from "@agents-in-the-cloud/llm/server";
import { shellQuote } from "@agents-in-the-cloud/core";
import { loadWorkspaceAgentsFiles } from "@agents-in-the-cloud/builtin-agent/server/workspace-agents-files";
import { codexVersion } from "./protocol.ts";

export const agentTypeId = "codex-app-server";
export const label = "Codex Native";
export const settings = createCliModelSettings({ agentTypeId, provider: "openai-codex", label: "Codex", mapThinkingLevel: (level, mapped) => mapped === null ? undefined : mapped ?? (level === "off" ? "none" : level) });
export async function requireSetup() {
  await requireProviderSubscription(await createPiModelRuntime(), "openai-codex", "Codex");
}
export function codexHome(agentId: string) { return `/home/agents-in-the-cloud/.local/share/agents-in-the-cloud-agents/${agentId}/codex`; }

export async function prepareCodex(workspaceId: string, agentId: string): Promise<string> {
  await installCodexSubscriptionAuth(workspaceId, codexHome(agentId), await createPiModelRuntime());
  const connection = await prepareCliAgentConnection(workspaceId, agentId, agentsInTheCloudSystemPrompt);
  // Codex keeps its base coding prompt, AGENTS.md discovery and native tools.
  // Only the renderer-aware application guidance and plugin instructions differ.
  const files = await loadWorkspaceAgentsFiles(workspaceId, { includeRoot: false });
  const instructions = [connection.instructions, ...files.map(file => `# Project instructions: ${file.path}\n\n${file.content}`)].join("\n\n");
  const config = `cli_auth_credentials_store = "file"\n[mcp_servers.agents-in-the-cloud]\nurl = ${JSON.stringify(connection.url)}\nrequired = true\ntool_timeout_sec = 3600\n[mcp_servers.agents-in-the-cloud.http_headers]\nAuthorization = ${JSON.stringify("Bearer " + connection.token)}\n`;
  await checkedWorkspaceShell(workspaceId, `umask 077; cat > ${shellQuote(`${codexHome(agentId)}/config.toml`)}`, config);
  await checkedWorkspaceShell(workspaceId, cliLaunchScript({ executable: "codex", label: "Codex", npmPackage: "@openai/codex", version: codexVersion, args: ["--version"] }));
  return instructions;
}
