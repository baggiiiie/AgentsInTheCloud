import { fileURLToPath } from "node:url";
import { checkedWorkspaceShell, type CliAgentSession } from "@atelier/cli-agent/server";
import { shellQuote } from "@atelier/core";

function piAtelierDirectory(session: CliAgentSession): string {
  return `${session.directory}/pi-atelier`;
}

export function piAtelierExtensionPath(session: CliAgentSession): string {
  return `${piAtelierDirectory(session)}/extension.mjs`;
}

let bundledExtension: Promise<string> | undefined;
function buildExtension(): Promise<string> {
  return bundledExtension ??= (async () => {
    const result = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../extension/pi-atelier.ts", import.meta.url))],
      target: "node",
      format: "esm",
      minify: true,
      sourcemap: "none",
    });
    if (!result.success) throw new Error(`Could not bundle the pi-atelier extension: ${result.logs.map(String).join("\n")}`);
    return await result.outputs[0]!.text();
  })();
}

/** Install native MCP registration and turn notifications with a session-private credential. */
export async function preparePiMcp(workspaceId: string, session: CliAgentSession, mcp: { url: string; token: string }): Promise<Record<string, string>> {
  const directory = piAtelierDirectory(session);
  const extension = await buildExtension();
  const config = JSON.stringify({ ...mcp, turnSignalCommand: session.turnSignalCommand });
  await checkedWorkspaceShell(workspaceId, `set -eu
umask 077
mkdir -p ${shellQuote(directory)}
dd bs=1 count=${Buffer.byteLength(extension)} of=${shellQuote(piAtelierExtensionPath(session))} status=none
cat > ${shellQuote(`${directory}/config.json`)}`, extension + config);
  return {};
}
