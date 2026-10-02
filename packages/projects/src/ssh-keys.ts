import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentsInTheCloudCoreError, runCommand } from "@agents-in-the-cloud/core";
import { decryptProjectValue, encryptProjectValue } from "./secret-crypto.ts";
import { findProjectRecord, projectsFile, readProjectStore, updateProjectStore, type ProjectSshKeySummary, type StoredProjectSshKey } from "./project.ts";

async function publicKeyFromPrivateKey(privateKey: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agents-in-the-cloud-ssh-key-"));
  const file = join(directory, "private-key");
  try {
    await writeFile(file, privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`, { mode: 0o600 });
    const { stdout, stderr, exitCode } = await runCommand(["ssh-keygen", "-y", "-P", "", "-f", file]);
    if (exitCode !== 0) throw new AgentsInTheCloudCoreError("invalid_ssh_private_key", stderr.trim() || "ssh-keygen rejected the private key; use an unencrypted OpenSSH private key");
    const [keyType, encodedKey] = stdout.toString().trim().split(/\s+/, 2);
    if (!keyType || !encodedKey) throw new AgentsInTheCloudCoreError("invalid_ssh_private_key", "ssh-keygen returned an invalid public key");
    return `${keyType} ${encodedKey}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function summary(key: StoredProjectSshKey): ProjectSshKeySummary {
  const { encryptedPrivateKey: _, ...result } = key;
  return result;
}

export async function listProjectSshKeys(projectId: string, file = projectsFile()): Promise<ProjectSshKeySummary[]> {
  const project = findProjectRecord(await readProjectStore(file), projectId);
  return (project.sshKeys ?? []).map(summary);
}

export async function createProjectSshKey(projectId: string, privateKey: string, file = projectsFile(), keyFile?: string, name = ""): Promise<ProjectSshKeySummary> {
  if (!privateKey.trim()) throw new AgentsInTheCloudCoreError("invalid_arguments", "Private key is required");
  privateKey = privateKey.replace(/\r\n/g, "\n");
  return await updateProjectStore(file, async (store) => {
    const project = findProjectRecord(store, projectId);
    const id = randomUUID();
    const publicKey = await publicKeyFromPrivateKey(privateKey);
    const key = {
      id,
      projectId,
      name: name.trim(),
      keyType: publicKey.split(" ", 1)[0]!,
      createdAt: new Date().toISOString(),
      encryptedPrivateKey: await encryptProjectValue(projectId, id, privateKey, keyFile),
    };
    project.sshKeys ??= [];
    project.sshKeys.push(key);
    return summary(key);
  });
}

export async function deriveProjectSshPublicKey(projectId: string, keyId: string, file = projectsFile(), keyFile?: string): Promise<string> {
  const project = findProjectRecord(await readProjectStore(file), projectId);
  const key = (project.sshKeys ?? []).find((candidate) => candidate.id === keyId);
  if (!key) throw new AgentsInTheCloudCoreError("project_ssh_key_not_found", "project SSH key not found");
  return await publicKeyFromPrivateKey(await decryptProjectValue(projectId, key.id, key.encryptedPrivateKey, keyFile));
}

export async function renameProjectSshKey(projectId: string, keyId: string, name: string, file = projectsFile()): Promise<ProjectSshKeySummary> {
  return await updateProjectStore(file, (store) => {
    const project = findProjectRecord(store, projectId);
    const key = (project.sshKeys ?? []).find((candidate) => candidate.id === keyId);
    if (!key) throw new AgentsInTheCloudCoreError("project_ssh_key_not_found", "project SSH key not found");
    key.name = name.trim();
    return summary(key);
  });
}

export async function deleteProjectSshKey(projectId: string, keyId: string, file = projectsFile()): Promise<ProjectSshKeySummary> {
  return await updateProjectStore(file, (store) => {
    const project = findProjectRecord(store, projectId);
    const keys = project.sshKeys ?? [];
    const key = keys.find((candidate) => candidate.id === keyId);
    if (!key) throw new AgentsInTheCloudCoreError("project_ssh_key_not_found", "project SSH key not found");
    project.sshKeys = keys.filter((candidate) => candidate.id !== keyId);
    return summary(key);
  });
}

export async function revealProjectSshKeys(projectId: string, file = projectsFile(), keyFile?: string): Promise<string[]> {
  const project = findProjectRecord(await readProjectStore(file), projectId);
  return await Promise.all((project.sshKeys ?? []).map((key) => decryptProjectValue(projectId, key.id, key.encryptedPrivateKey, keyFile)));
}
