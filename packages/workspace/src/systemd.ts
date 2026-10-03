import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceDockerPlan } from "./types.ts";

/** Snapshot Docker support and setup; runtime units are owned by the image. */
export async function prepareWorkspaceSystemd(plan: WorkspaceDockerPlan, directory: string, init: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const source = join(directory, "init.sh");
  await writeFile(source, init);
  plan.containerFiles.push({ source, target: "/.agents-in-the-cloud/init.sh" });
  const dockerSupport = join(directory, "docker-support");
  await writeFile(dockerSupport, `${plan.privileged ? "enabled" : "disabled"}\n${plan.dockerSupportSettingsUrl ?? ""}\n`);
  plan.containerFiles.push({ source: dockerSupport, target: "/etc/agents-in-the-cloud/docker-support" });
  // systemd needs a writable cgroup mount; Docker can grant one without privileged mode.
  plan.extraArgs.push(...(plan.privileged ? ["--privileged"] : ["--security-opt", "writable-cgroups=true"]));
  plan.extraArgs.push("--cgroupns=private", "--tmpfs", "/run", "--stop-signal", "SIGRTMIN+3");
}
