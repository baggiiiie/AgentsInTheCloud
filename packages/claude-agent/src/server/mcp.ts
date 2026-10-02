import { checkedWorkspaceShell, type CliAgentSession } from "@agents-in-the-cloud/cli-agent/server";
import { shellQuote } from "@agents-in-the-cloud/core";

/** Session-private MCP configuration; the bearer token never reaches a command line. */
export function claudeMcpConfigPath(session: CliAgentSession): string {
  return `${session.directory}/claude-mcp.json`;
}

export async function prepareClaudeMcp(workspaceId: string, session: CliAgentSession, mcp: { url: string; token: string }): Promise<Record<string, string>> {
  const config = { mcpServers: { "agents-in-the-cloud": { type: "http", url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } };
  await checkedWorkspaceShell(workspaceId, `umask 077; cat > ${shellQuote(claudeMcpConfigPath(session))}`, JSON.stringify(config));
  return {};
}
