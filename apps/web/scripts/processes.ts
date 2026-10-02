import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AgentsInTheCloudProcessInfo {
  pid: number;
  ppid: number;
  command: string;
  kind: "dev" | "server";
}

export async function listAgentsInTheCloudProcesses(options: { excludePid?: number } = {}): Promise<AgentsInTheCloudProcessInfo[]> {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): AgentsInTheCloudProcessInfo[] => {
      const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      if (!match) return [];
      const pid = Number(match[1]);
      const ppid = Number(match[2]);
      const command = match[3];
      const kind = agentsInTheCloudProcessKind(command);
      if (!kind || pid === options.excludePid) return [];
      return [{ pid, ppid, command, kind }];
    });
}

export function sortAgentsInTheCloudProcesses(processes: AgentsInTheCloudProcessInfo[]): AgentsInTheCloudProcessInfo[] {
  return [...processes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dev" ? -1 : 1;
    return a.pid - b.pid;
  });
}

function agentsInTheCloudProcessKind(command: string): AgentsInTheCloudProcessInfo["kind"] | undefined {
  if (!/\bbun\b/.test(command)) return undefined;

  if (
    command.includes("apps/web/scripts/dev.ts")
    || command.includes("scripts/dev.ts")
    || command.includes("bun run --cwd apps/web dev")
    || command.includes("bun run web")
  ) return "dev";

  if (
    command.includes("apps/web/src/server/main.ts")
    || command.includes("src/server/main.ts")
  ) return "server";

  return undefined;
}
