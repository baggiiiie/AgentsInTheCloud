import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { atelierDataPath, dockerHostAtelierDataPath, getAtelierRuntimeContext, type AtelierEventBus } from "@atelier/core";
import { listWorkspaces } from "@atelier/workspace";
import { isGitProjectInit } from "./project.ts";
import { revealProjectSshKeys } from "./ssh-keys.ts";
import { prepareWorkspaceSshTrust, workspaceGitSshCommand } from "./ssh-host-trust.ts";
import { SharedSshAgent } from "./shared-ssh-agent.ts";

const containerAgentDir = "/run/atelier-ssh-agent";
let shared: SharedSshAgent | undefined;

function agentDir(workspaceId: string): string {
  return atelierDataPath(getAtelierRuntimeContext(), "ssh-agents", workspaceId);
}

function sshEnvironment(directory: string) {
  return {
    SSH_AUTH_SOCK: join(directory, "agent.sock"),
    GIT_SSH_COMMAND: workspaceGitSshCommand(join(directory, "known_hosts")),
  };
}

export async function workspaceSourceSshEnvironment(workspaceId: string, projectId?: string): Promise<Record<string, string>> {
  // One module owns the signing backend for the lifetime of Atelier, not a workspace.
  shared ??= new SharedSshAgent(atelierDataPath(getAtelierRuntimeContext(), "ssh-signer"), async (id) => id ? revealProjectSshKeys(id) : []);
  const directory = agentDir(workspaceId);
  await shared.listen(join(directory, "agent.sock"), projectId);
  await prepareWorkspaceSshTrust(directory, projectId);
  await writeFile(join(directory, "workspace_known_hosts"), "", { flag: "wx" }).catch(error => {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  });
  return sshEnvironment(directory);
}

export async function stopWorkspaceSshAgent(workspaceId: string): Promise<void> {
  await shared?.remove(join(agentDir(workspaceId), "agent.sock"));
}

export async function stopProjectSshAgents(): Promise<void> {
  const agent = shared;
  shared = undefined;
  await agent?.close();
}

export function registerProjectSshAgentWorkspaceEvents(events: AtelierEventBus): void {
  events.on("workspace_plan_prepare", async ({ workspaceId, init, plan }) => {
    await workspaceSourceSshEnvironment(workspaceId, isGitProjectInit(init) ? init.projectId : undefined);
    Object.assign(plan.env, sshEnvironment(containerAgentDir));
    const directory = agentDir(workspaceId);
    const command = `#!/bin/sh
set -eu
host="$1"
port="$2"
keys="$(ssh-keyscan -T 5 -p "$port" "$host" 2>/dev/null)"
[ -n "$keys" ] || exit 1
printf '%s\\n' "$keys" | curl --noproxy '*' --fail --silent --show-error --max-time 1810 --unix-socket /run/atelier-parent/ingress.sock \\
  --data-urlencode "host=$host" --data-urlencode "port=$port" --data-urlencode 'keys@-' http://localhost/ssh/host-keys
`;
    await writeFile(join(directory, "known-hosts-command"), command, { mode: 0o755 });
    await writeFile(join(directory, "ssh_config"), `Host *\n    KnownHostsCommand /run/atelier-ssh-agent/known-hosts-command %h %p\n    UserKnownHostsFile /run/atelier-ssh-agent/known_hosts /run/atelier-ssh-agent/workspace_known_hosts ~/.ssh/known_hosts\n    StrictHostKeyChecking yes\n`);
    plan.containerFiles.push({ source: join(directory, "ssh_config"), target: "/etc/ssh/ssh_config.d/atelier.conf" });
    plan.initScripts.push("chown root:root /etc/ssh/ssh_config.d/atelier.conf; chmod 644 /etc/ssh/ssh_config.d/atelier.conf");
    plan.mounts.push({ type: "bind", source: dockerHostAtelierDataPath(getAtelierRuntimeContext(), "ssh-agents", workspaceId), target: containerAgentDir, readonly: true });
    plan.cleanup.push(() => stopWorkspaceSshAgent(workspaceId));
  });
  events.on("workspace_deleted", async ({ workspaceId }) => stopWorkspaceSshAgent(workspaceId));
}

export async function restoreProjectSshAgents(): Promise<void> {
  for (const workspace of (await listWorkspaces()).workspaces) {
    await workspaceSourceSshEnvironment(workspace.id, isGitProjectInit(workspace.init) ? workspace.init.projectId : undefined);
  }
}
