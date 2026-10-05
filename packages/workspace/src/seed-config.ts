import { dirname, join } from "node:path";
import { agentsInTheCloudDataPath, type AgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import type { RepoWorkspaceManifest } from "./index.ts";
import type { WorkspaceDockerPlan } from "./types.ts";
import { seedConfigInstallScript } from "./startup-scripts.ts";

export async function applySeedConfigManifest(manifest: RepoWorkspaceManifest, plan: WorkspaceDockerPlan, runtime: AgentsInTheCloudRuntimeContext): Promise<void> {
  const entries = [
    manifest.seedPiConfig?.authJson ? { source: agentsInTheCloudDataPath(runtime, "pi-config", "auth.json"), staging: "/.agents-in-the-cloud/seed-pi-auth.json", target: manifest.seedPiConfig.authJson } : undefined,
    manifest.seedPiConfig?.modelsJson ? { source: agentsInTheCloudDataPath(runtime, "pi-config", "models.json"), staging: "/.agents-in-the-cloud/seed-pi-models.json", target: manifest.seedPiConfig.modelsJson } : undefined,
    manifest.seedPiConfig?.modelsStoreJson ? { source: agentsInTheCloudDataPath(runtime, "pi-config", "models-store.json"), staging: "/.agents-in-the-cloud/seed-pi-models-store.json", target: manifest.seedPiConfig.modelsStoreJson } : undefined,
    manifest.seedAgentsInTheCloudConfig?.projectsJson ? { source: agentsInTheCloudDataPath(runtime, "projects.json"), staging: "/.agents-in-the-cloud/seed-projects.json", target: manifest.seedAgentsInTheCloudConfig.projectsJson } : undefined,
  ].filter((entry): entry is { source: string; staging: string; target: string } => Boolean(entry));
  const projectsJson = manifest.seedAgentsInTheCloudConfig?.projectsJson;
  const keySource = agentsInTheCloudDataPath(runtime, "project-secrets.key");
  // The catalogue includes encrypted secrets and SSH keys. Seed its key alongside it,
  // but hosts that have never stored an encrypted value do not have a key yet.
  if (projectsJson && await Bun.file(keySource).exists()) {
    entries.push({ source: keySource, staging: "/.agents-in-the-cloud/seed-project-secrets.key", target: join(dirname(projectsJson), "project-secrets.key") });
  }
  for (const entry of entries) {
    plan.containerFiles.push({ source: entry.source, target: entry.staging });
    plan.initScripts.push(seedConfigInstallScript(entry.staging, entry.target));
  }
}

