import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const configSchema = Type.Object({ url: Type.String(), token: Type.String(), turnSignalCommand: Type.String() });
type AgentsInTheCloudMcpConfig = Static<typeof configSchema>;

/** Pi owns MCP discovery, execution, and instructions; we only wire up the session. */
export function registerPiAgentsInTheCloud(pi: ExtensionAPI, config: AgentsInTheCloudMcpConfig): void {
  pi.registerMcpServer("agents-in-the-cloud", {
    url: config.url,
    headers: { Authorization: `Bearer ${config.token}` },
    exposure: "codemode",
    timeout: 3_600,
  });

  async function signalTurn(boundary: "started" | "finished"): Promise<void> {
    const result = await pi.exec("sh", [config.turnSignalCommand, boundary]);
    if (result.code !== 0) throw new Error(result.stderr);
  }

  pi.on("agent_start", () => signalTurn("started"));
  pi.on("agent_end", () => signalTurn("finished"));
}

export default async function piAgentsInTheCloudExtension(pi: ExtensionAPI): Promise<void> {
  const config = Value.Parse(configSchema, JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8")));
  registerPiAgentsInTheCloud(pi, config);
}
