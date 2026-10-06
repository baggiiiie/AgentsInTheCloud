import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentsInTheCloudCoreError, agentsInTheCloudDataPath, type AgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import type { RepoWorkspaceManifest } from "./index.ts";
import type { WorkspaceDockerPlan } from "./types.ts";
import { seedConfigInstallScript } from "./startup-scripts.ts";

export async function applySeedConfigManifest(manifest: RepoWorkspaceManifest, plan: WorkspaceDockerPlan, runtime: AgentsInTheCloudRuntimeContext, seedDirectory: string): Promise<void> {
  if ((manifest.seedPiConfig || manifest.seedAgentsInTheCloudConfig) && !plan.seedConfigEnabled) {
    throw new AgentsInTheCloudCoreError("workspace_seed_config_disabled", "This repository requests Atelier-in-Atelier seeding. Enable it in the workspace template’s Developer Settings (hold Alt in template settings), then create a new workspace.");
  }
  const entries: Array<{ source: string; staging: string; target: string }> = [];
  for (const [name, target] of [
    ["auth", manifest.seedPiConfig?.authJson],
    ["models", manifest.seedPiConfig?.modelsJson],
    ["models-store", manifest.seedPiConfig?.modelsStoreJson],
  ] as const) {
    if (target) entries.push({ source: agentsInTheCloudDataPath(runtime, "pi-config", `${name}.json`), staging: `/.agents-in-the-cloud/seed-pi-${name}.json`, target });
  }
  const projectsJson = manifest.seedAgentsInTheCloudConfig?.projectsJson;
  if (projectsJson) {
    // Sanitize on the host: neither encrypted credentials nor the master key may
    // cross into the agent workspace, even as temporary staging files.
    const catalogue = JSON.parse(await readFile(agentsInTheCloudDataPath(runtime, "projects.json"), "utf8"));
    const sanitized = JSON.stringify(catalogue, (key, value) =>
      key === "encryptedSecret" || key === "encryptedPrivateKey" || key === "sshKeys" ? undefined : value,
    );
    await mkdir(seedDirectory, { recursive: true });
    const source = join(seedDirectory, "projects.json");
    await writeFile(source, `${sanitized}\n`, { mode: 0o600 });
    entries.push({ source, staging: "/.agents-in-the-cloud/seed-projects.json", target: projectsJson });
  }
  for (const entry of entries) {
    plan.containerFiles.push({ source: entry.source, target: entry.staging });
    plan.initScripts.push(seedConfigInstallScript(entry.staging, entry.target));
  }
}

