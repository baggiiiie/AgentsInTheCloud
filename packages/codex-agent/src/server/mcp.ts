import { checkedWorkspaceShell, type CliAgentSession } from "@agents-in-the-cloud/cli-agent/server";
import { shellQuote } from "@agents-in-the-cloud/core";

export async function prepareCodexMcp(workspaceId: string, session: CliAgentSession, mcp: { url: string; token: string }): Promise<Record<string, string>> {
  const codexHome = `${session.directory}/codex`;
  await checkedWorkspaceShell(workspaceId, `umask 077; mkdir -p ${shellQuote(codexHome)} && ln -sf /home/agents-in-the-cloud/.codex/auth.json ${shellQuote(codexHome + "/auth.json")} && cat > ${shellQuote(codexHome + "/config.toml")}`,
    `[mcp_servers.agents-in-the-cloud]\nurl = ${JSON.stringify(mcp.url)}\nrequired = true\ntool_timeout_sec = 3600\n[mcp_servers.agents-in-the-cloud.http_headers]\nAuthorization = ${JSON.stringify("Bearer " + mcp.token)}\n`);
  return { CODEX_HOME: codexHome };
}
