import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentsInTheCloudDataPath, type AgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import type { RepoWorkspaceManifest } from "./index.ts";
import type { WorkspaceDockerPlan } from "./types.ts";
import { seedConfigInstallScript } from "./startup-scripts.ts";

export async function applySeedConfigManifest(manifest: RepoWorkspaceManifest, plan: WorkspaceDockerPlan, runtime: AgentsInTheCloudRuntimeContext, seedDirectory: string): Promise<void> {
  const entries = [
    manifest.seedPiConfig?.authJson ? { source: agentsInTheCloudDataPath(runtime, "pi-config", "auth.json"), staging: "/.agents-in-the-cloud/seed-pi-auth.json", target: manifest.seedPiConfig.authJson } : undefined,
    manifest.seedPiConfig?.modelsJson ? { source: agentsInTheCloudDataPath(runtime, "pi-config", "models.json"), staging: "/.agents-in-the-cloud/seed-pi-models.json", target: manifest.seedPiConfig.modelsJson } : undefined,
    manifest.seedPiConfig?.modelsStoreJson ? { source: agentsInTheCloudDataPath(runtime, "pi-config", "models-store.json"), staging: "/.agents-in-the-cloud/seed-pi-models-store.json", target: manifest.seedPiConfig.modelsStoreJson } : undefined,
  ].filter((entry): entry is { source: string; staging: string; target: string } => Boolean(entry));
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

