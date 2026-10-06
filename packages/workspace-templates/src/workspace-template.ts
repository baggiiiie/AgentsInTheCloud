import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { acquireFileLock, AgentsInTheCloudCoreError, getAgentsInTheCloudRuntimeContext, isNotFoundError, writeJsonAtomic } from "@agents-in-the-cloud/core";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export type WorkspaceTemplateSummary = Omit<WorkspaceTemplateRecord, "secrets" | "sshKeys" | "sshKnownHosts" | "environment"> & {
  configurationFingerprint?: string;
  /** Adding a template counts as using it, as does creating a workspace from it. */
  lastUsedAt?: number;
};
export type StoredWorkspaceTemplateSecret = Static<typeof storedWorkspaceTemplateSecretSchema>;
export type WorkspaceTemplateSecretSummary = Omit<StoredWorkspaceTemplateSecret, "encryptedSecret" | "optional" | "annotation"> & { annotation: string; optional: boolean; configured: boolean };
export type StoredWorkspaceTemplateSshKey = Static<typeof storedWorkspaceTemplateSshKeySchema>;
export type WorkspaceTemplateSshKeySummary = Omit<StoredWorkspaceTemplateSshKey, "encryptedPrivateKey">;
export type WorkspaceTemplateEnvironmentVariable = Static<typeof workspaceTemplateEnvironmentVariableSchema>;
export type WorkspaceTemplateRecord = Static<typeof workspaceTemplateRecordSchema>;
export type WorkspaceTemplateStore = Static<typeof workspaceTemplateStoreSchema>;

export interface WorkspaceTemplateListResult {
  workspaceTemplates: WorkspaceTemplateSummary[];
}

export interface AddWorkspaceTemplateResult {
  workspaceTemplate: WorkspaceTemplateSummary;
}

export interface DeleteWorkspaceTemplateResult {
  workspaceTemplate: WorkspaceTemplateSummary;
}

export interface UpdateWorkspaceTemplateResult {
  workspaceTemplate: WorkspaceTemplateSummary;
}

const storedWorkspaceTemplateSecretSchema = Type.Object({
  id: Type.String(),
  projectId: Type.String(),
  envName: Type.String(),
  hostPattern: Type.String(),
  allowInPath: Type.Optional(Type.Boolean()),
  placeholder: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  encryptedSecret: Type.Optional(Type.String()),
  annotation: Type.Optional(Type.String()),
  optional: Type.Optional(Type.Boolean()),
});

const workspaceTemplateEnvironmentVariableSchema = Type.Object({
  id: Type.String(),
  projectId: Type.String(),
  name: Type.String(),
  value: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const storedWorkspaceTemplateSshKeySchema = Type.Object({
  id: Type.String(),
  projectId: Type.String(),
  keyType: Type.String(),
  name: Type.Optional(Type.String()),
  createdAt: Type.String(),
  encryptedPrivateKey: Type.String(),
});

const workspaceTemplateRecordSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  gitUrl: Type.String(),
  branch: Type.Union([Type.String(), Type.Null()]),
  sessionShareKey: Type.String(),
  /** Absent on templates added before this was recorded. */
  createdAt: Type.Optional(Type.Number()),
  lastWorkspaceCreatedAt: Type.Optional(Type.Number()),
  secrets: Type.Optional(Type.Array(storedWorkspaceTemplateSecretSchema)),
  sshKeys: Type.Optional(Type.Array(storedWorkspaceTemplateSshKeySchema)),
  sshKnownHosts: Type.Optional(Type.String()),
  environment: Type.Optional(Type.Array(workspaceTemplateEnvironmentVariableSchema)),
  privileged: Type.Optional(Type.Boolean()),
  seedConfigEnabled: Type.Optional(Type.Boolean()),
  dockerfile: Type.Optional(Type.String()),
  preloadImages: Type.Optional(Type.Array(Type.String())),
});

const gitWorkspaceTemplateInitSchema = Type.Object({
  type: Type.Literal("project.git"),
  configurationFingerprint: Type.Optional(Type.String()),
  projectId: Type.String(),
  name: Type.String(),
  gitUrl: Type.String(),
  branch: Type.Union([Type.String(), Type.Null()]),
  sessionShareKey: Type.String(),
});

export type GitWorkspaceTemplateInitInstruction = Static<typeof gitWorkspaceTemplateInitSchema>;

declare module "@agents-in-the-cloud/workspace" {
  interface WorkspaceInitInstructionMap {
    "project.git": GitWorkspaceTemplateInitInstruction;
  }
}

const workspaceTemplateStoreSchema = Type.Object({
  projects: Type.Array(workspaceTemplateRecordSchema),
});

export function workspaceTemplatesFile(dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): string {
  return join(dataDir, "projects.json");
}

export function workspaceTemplateNameFromGitUrl(url: string): string {
  const trimmed = url.trim().replace(/[/?#]+$/, "");
  const last = basename(trimmed);
  const withoutGit = last.endsWith(".git") ? last.slice(0, -4) : last;
  const safe = withoutGit.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!safe || safe === "." || safe === "..") throw new AgentsInTheCloudCoreError("invalid_git_url", `could not derive template name from ${url}`);
  return safe;
}

function workspaceTemplateId(gitUrl: string, branch: string | null): string {
  const base = workspaceTemplateNameFromGitUrl(gitUrl);
  const digest = createHash("sha256").update(`${gitUrl}\0${branch ?? ""}`).digest("hex").slice(0, 8);
  return `${base}-${digest}`;
}

export function formatWorkspaceTemplateSpec(workspaceTemplate: Pick<WorkspaceTemplateSummary, "gitUrl" | "branch">): string {
  return `${workspaceTemplate.gitUrl}${workspaceTemplate.branch ? `#${workspaceTemplate.branch}` : ""}`;
}

export function parseWorkspaceTemplateSpec(spec: string): { gitUrl: string; branch: string | null } {
  const trimmed = spec.trim();
  if (!trimmed) throw new AgentsInTheCloudCoreError("invalid_git_url", "git url is required");

  const normalized = /^github\.com\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
  const [gitUrl, branch] = normalized.split(/#(.+)/, 2).map((part) => part.trim());
  return gitUrl && branch ? { gitUrl, branch } : { gitUrl: normalized, branch: null };
}

export async function readWorkspaceTemplateStore(file: string): Promise<WorkspaceTemplateStore> {
  try {
    const store = Value.Parse(workspaceTemplateStoreSchema, JSON.parse(await readFile(file, "utf8")));
    // Older records may contain derived SSH metadata; keep only the encrypted key and its label.
    for (const workspaceTemplate of store.projects) for (const key of workspaceTemplate.sshKeys ?? []) {
      Reflect.deleteProperty(key, "publicKey");
      Reflect.deleteProperty(key, "fingerprint");
    }
    return store;
  } catch (error) {
    if (isNotFoundError(error)) return { projects: [] };
    throw error;
  }
}

const workspaceTemplateStoreListeners = new Set<() => void>();

export function onWorkspaceTemplateStoreChanged(listener: () => void): () => void {
  workspaceTemplateStoreListeners.add(listener);
  return () => { workspaceTemplateStoreListeners.delete(listener); };
}

/** Owns the complete read-modify-write operation so concurrent changes cannot overwrite one another. */
export async function updateWorkspaceTemplateStore<Result>(file: string, mutate: (store: WorkspaceTemplateStore) => Result | Promise<Result>): Promise<Result> {
  const release = await acquireFileLock(`${file}.lock`, "projects");
  try {
    const store = await readWorkspaceTemplateStore(file);
    const result = await mutate(store);
    await writeJsonAtomic(file, store);
    for (const listener of workspaceTemplateStoreListeners) listener();
    return result;
  } finally {
    await release();
  }
}

export function findWorkspaceTemplateRecord(store: WorkspaceTemplateStore, workspaceTemplateId: string): WorkspaceTemplateRecord {
  const workspaceTemplate = store.projects.find((candidate) => candidate.id === workspaceTemplateId);
  if (!workspaceTemplate) throw new AgentsInTheCloudCoreError("workspace_template_not_found", `template not found: ${workspaceTemplateId}`);
  return workspaceTemplate;
}

export function workspaceTemplateConfigurationFingerprint(workspaceTemplate: Pick<WorkspaceTemplateRecord, "gitUrl" | "branch" | "dockerfile" | "privileged" | "seedConfigEnabled" | "secrets" | "sshKnownHosts"> & { environment?: Pick<WorkspaceTemplateEnvironmentVariable, "name" | "value">[] }): string {
  // Only workspace setup snapshots belong here; SSH keys are authorized live. Renaming a template
  // also changes its session share key, which is not worth warning existing workspaces about.
  const configuration = {
    gitUrl: workspaceTemplate.gitUrl, branch: workspaceTemplate.branch,
    privileged: workspaceTemplate.privileged ?? false,
    seedConfigEnabled: workspaceTemplate.seedConfigEnabled ?? false,
    dockerfile: workspaceTemplate.dockerfile ?? "",
    environment: (workspaceTemplate.environment ?? []).map(({ name, value }) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name)),
    secrets: (workspaceTemplate.secrets ?? []).filter((secret) => secret.encryptedSecret).map(({ envName, hostPattern, placeholder, allowInPath, encryptedSecret }) => ({ envName, hostPattern, placeholder, allowInPath, encryptedSecret })).sort((a, b) => a.envName.localeCompare(b.envName)),
    sshKnownHosts: workspaceTemplate.sshKnownHosts ?? "",
  };
  return createHash("sha256").update(JSON.stringify(configuration)).digest("hex");
}

function workspaceTemplateSummary(workspaceTemplate: WorkspaceTemplateRecord): WorkspaceTemplateSummary {
  return {
    id: workspaceTemplate.id,
    name: workspaceTemplate.name,
    gitUrl: workspaceTemplate.gitUrl,
    branch: workspaceTemplate.branch,
    sessionShareKey: workspaceTemplate.sessionShareKey,
    createdAt: workspaceTemplate.createdAt,
    lastWorkspaceCreatedAt: workspaceTemplate.lastWorkspaceCreatedAt,
    lastUsedAt: Math.max(workspaceTemplate.createdAt ?? 0, workspaceTemplate.lastWorkspaceCreatedAt ?? 0) || undefined,
    privileged: workspaceTemplate.privileged ?? false,
    seedConfigEnabled: workspaceTemplate.seedConfigEnabled ?? false,
    dockerfile: workspaceTemplate.dockerfile,
    preloadImages: [...(workspaceTemplate.preloadImages ?? [])],
    configurationFingerprint: workspaceTemplateConfigurationFingerprint(workspaceTemplate),
  };
}

export type WorkspaceTemplateConfiguration = WorkspaceTemplateSummary & {
  environment: WorkspaceTemplateEnvironmentVariable[];
  secrets: WorkspaceTemplateSecretSummary[];
};

export function workspaceTemplateSecretSummary(secret: StoredWorkspaceTemplateSecret): WorkspaceTemplateSecretSummary {
  const { encryptedSecret, ...metadata } = secret;
  return { ...metadata, annotation: secret.annotation ?? "", optional: secret.optional ?? false, configured: !!encryptedSecret };
}

export function workspaceTemplateSecretSummaries(workspaceTemplate: WorkspaceTemplateRecord): WorkspaceTemplateSecretSummary[] {
  return (workspaceTemplate.secrets ?? []).map(workspaceTemplateSecretSummary).sort((a, b) => a.envName.localeCompare(b.envName));
}

/** Non-sensitive settings derived from a single persisted template snapshot. */
export async function getWorkspaceTemplateConfiguration(workspaceTemplateId: string, file = workspaceTemplatesFile()): Promise<WorkspaceTemplateConfiguration> {
  const workspaceTemplate = findWorkspaceTemplateRecord(await readWorkspaceTemplateStore(file), workspaceTemplateId);
  return {
    ...workspaceTemplateSummary(workspaceTemplate),
    environment: [...(workspaceTemplate.environment ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    secrets: workspaceTemplateSecretSummaries(workspaceTemplate),
  };
}

export async function listWorkspaceTemplates(file = workspaceTemplatesFile()): Promise<WorkspaceTemplateListResult> {
  const store = await readWorkspaceTemplateStore(file);
  const workspaceTemplates = [...store.projects].sort((a, b) => a.name.localeCompare(b.name) || (a.branch ?? "").localeCompare(b.branch ?? "") || a.gitUrl.localeCompare(b.gitUrl)).map(workspaceTemplateSummary);
  return { workspaceTemplates };
}

export async function addWorkspaceTemplate(spec: string, file = workspaceTemplatesFile()): Promise<AddWorkspaceTemplateResult> {
  const { gitUrl, branch } = parseWorkspaceTemplateSpec(spec);
  const id = workspaceTemplateId(gitUrl, branch);
  return await updateWorkspaceTemplateStore(file, (store) => {
    if (store.projects.some((workspaceTemplate) => workspaceTemplate.id === id || (workspaceTemplate.gitUrl === gitUrl && workspaceTemplate.branch === branch))) {
      throw new AgentsInTheCloudCoreError("workspace_template_exists", `template already exists: ${formatWorkspaceTemplateSpec({ gitUrl, branch })}`);
    }
    const baseName = workspaceTemplateNameFromGitUrl(gitUrl);
    const name = store.projects.some((workspaceTemplate) => workspaceTemplate.gitUrl === gitUrl)
      ? `${baseName} (${branch ?? "default branch"})`
      : baseName;
    const workspaceTemplate = { id, name, gitUrl, branch, sessionShareKey: baseName, createdAt: Date.now() };
    store.projects.push(workspaceTemplate);
    return { workspaceTemplate: workspaceTemplateSummary(workspaceTemplate) };
  });
}

/** Retained independently of workspaces so parking or deletion cannot erase recency. */
export async function recordWorkspaceCreation(workspaceTemplateId: string, createdAt = Date.now(), file = workspaceTemplatesFile()): Promise<void> {
  await updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, workspaceTemplateId);
    workspaceTemplate.lastWorkspaceCreatedAt = Math.max(workspaceTemplate.lastWorkspaceCreatedAt ?? 0, createdAt);
  });
}

export async function updateWorkspaceTemplate(id: string, values: { name: string; spec: string }, file = workspaceTemplatesFile()): Promise<UpdateWorkspaceTemplateResult> {
  return await updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, id);
    const name = values.name.trim();
    if (!name) throw new AgentsInTheCloudCoreError("invalid_arguments", "template name is required");
    const { gitUrl, branch } = parseWorkspaceTemplateSpec(values.spec);
    if (store.projects.some((candidate) => candidate.id !== id && candidate.gitUrl === gitUrl && candidate.branch === branch)) {
      throw new AgentsInTheCloudCoreError("workspace_template_exists", `template already exists: ${formatWorkspaceTemplateSpec({ gitUrl, branch })}`);
    }
    workspaceTemplate.name = name;
    workspaceTemplate.gitUrl = gitUrl;
    workspaceTemplate.branch = branch;
    workspaceTemplate.sessionShareKey = name;
    return { workspaceTemplate: workspaceTemplateSummary(workspaceTemplate) };
  });
}

export async function deleteWorkspaceTemplate(id: string, file = workspaceTemplatesFile()): Promise<DeleteWorkspaceTemplateResult> {
  return await updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, id);
    store.projects = store.projects.filter((candidate) => candidate.id !== id);
    return { workspaceTemplate: workspaceTemplateSummary(workspaceTemplate) };
  });
}

export function workspaceInitFromTemplate(workspaceTemplate: WorkspaceTemplateSummary): GitWorkspaceTemplateInitInstruction {
  return { type: "project.git", configurationFingerprint: workspaceTemplate.configurationFingerprint, projectId: workspaceTemplate.id, name: workspaceTemplate.name, gitUrl: workspaceTemplate.gitUrl, branch: workspaceTemplate.branch, sessionShareKey: workspaceTemplate.sessionShareKey };
}

export function isGitWorkspaceTemplateInit(init: unknown): init is GitWorkspaceTemplateInitInstruction {
  return Value.Check(gitWorkspaceTemplateInitSchema, init);
}

export function validateWorkspaceTemplateDockerfile(dockerfile: string): void {
  if (dockerfile.trim() && dockerfile.split("\n")[0]!.trim() !== "FROM agents-in-the-cloud-workspace") {
    throw new AgentsInTheCloudCoreError("invalid_arguments", "Dockerfile must start with FROM agents-in-the-cloud-workspace");
  }
}

export async function setWorkspaceTemplateDockerfile(id: string, dockerfile: string, file = workspaceTemplatesFile()): Promise<UpdateWorkspaceTemplateResult> {
  validateWorkspaceTemplateDockerfile(dockerfile);
  return await updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, id);
    if (dockerfile.trim()) workspaceTemplate.dockerfile = dockerfile;
    else delete workspaceTemplate.dockerfile;
    return { workspaceTemplate: workspaceTemplateSummary(workspaceTemplate) };
  });
}

export function validateWorkspaceTemplatePreloadImage(image: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/.test(image) || image.includes("://")) {
    throw new AgentsInTheCloudCoreError("invalid_arguments", `Invalid image reference: ${image || "(empty)"}`);
  }
}

/** Changes the preload set for future workspaces; existing workspace configuration is unchanged. */
export async function setWorkspaceTemplatePreloadImages(id: string, images: string[], file = workspaceTemplatesFile()): Promise<UpdateWorkspaceTemplateResult> {
  const preloadImages = [...new Set(images.map((image) => image.trim()))];
  preloadImages.forEach(validateWorkspaceTemplatePreloadImage);
  return await updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, id);
    workspaceTemplate.preloadImages = preloadImages;
    return { workspaceTemplate: workspaceTemplateSummary(workspaceTemplate) };
  });
}

/** Host-authorized opt-in; agent-editable workspace settings cannot grant privilege. */
export async function setWorkspaceTemplatePrivileged(id: string, privileged: boolean, file = workspaceTemplatesFile()): Promise<UpdateWorkspaceTemplateResult> {
  return updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, id);
    workspaceTemplate.privileged = privileged;
    return { workspaceTemplate: workspaceTemplateSummary(workspaceTemplate) };
  });
}

/** Only host template settings authorize exporting configuration into a workspace. */
export async function setWorkspaceTemplateSeedConfigEnabled(id: string, enabled: boolean, file = workspaceTemplatesFile()): Promise<UpdateWorkspaceTemplateResult> {
  return updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, id);
    workspaceTemplate.seedConfigEnabled = enabled;
    return { workspaceTemplate: workspaceTemplateSummary(workspaceTemplate) };
  });
}
