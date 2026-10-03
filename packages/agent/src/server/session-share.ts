import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getAgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import type { GitProjectInitInstruction } from "@agents-in-the-cloud/projects";
import { isGitProjectInit } from "@agents-in-the-cloud/projects";
import type { WorkspaceInitInstruction } from "@agents-in-the-cloud/workspace";

export const projectlessSessionShareKey = "projectless";
export const sessionShareMountPath = "/agents-in-the-cloud/session-share";

function workspaceMetadataInitPath(workspaceId: string, dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): string {
  return join(dataDir, "workspaces", workspaceId, "metadata", "init.json");
}

async function workspaceProjectInit(workspaceId: string, dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): Promise<GitProjectInitInstruction | undefined> {
  const file = Bun.file(workspaceMetadataInitPath(workspaceId, dataDir));
  if (!(await file.exists())) return undefined;
  const init: unknown = JSON.parse(await file.text());
  return isGitProjectInit(init) ? init : undefined;
}

function sessionSlug(value: string, maxLength: number, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function sessionShareKeySlug(value: string): string {
  return sessionSlug(value, 80, projectlessSessionShareKey);
}

export function sessionShareKeyForInit(init: WorkspaceInitInstruction | undefined): string {
  if (!isGitProjectInit(init)) return projectlessSessionShareKey;
  const key = init.sessionShareKey.trim()
    ? init.sessionShareKey
    : init.name;
  return sessionShareKeySlug(key);
}

export async function workspaceSessionShareKey(workspaceId: string, dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): Promise<string> {
  return sessionShareKeyForInit(await workspaceProjectInit(workspaceId, dataDir));
}

export function sessionShareDir(shareKey: string, dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): string {
  return join(dataDir, "session-shares", sessionShareKeySlug(shareKey));
}

/** Publish a complete snapshot while its source may continue receiving turns. */
export async function publishSessionSnapshot(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await copyFile(source, temporary);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
