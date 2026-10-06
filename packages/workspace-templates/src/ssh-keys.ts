import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentsInTheCloudCoreError, runCommand } from "@agents-in-the-cloud/core";
import { decryptWorkspaceTemplateValue, encryptWorkspaceTemplateValue } from "./secret-crypto.ts";
import { findWorkspaceTemplateRecord, workspaceTemplatesFile, readWorkspaceTemplateStore, updateWorkspaceTemplateStore, type WorkspaceTemplateSshKeySummary, type StoredWorkspaceTemplateSshKey, type WorkspaceTemplateRecord } from "./workspace-template.ts";

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

function summary(key: StoredWorkspaceTemplateSshKey): WorkspaceTemplateSshKeySummary {
  const { encryptedPrivateKey: _, projectId: workspaceTemplateId, ...result } = key;
  return { ...result, workspaceTemplateId };
}

function findSshKey(workspaceTemplate: WorkspaceTemplateRecord, keyId: string): StoredWorkspaceTemplateSshKey {
  const key = workspaceTemplate.sshKeys?.find((candidate) => candidate.id === keyId);
  if (!key) throw new AgentsInTheCloudCoreError("workspace_template_ssh_key_not_found", "template SSH key not found");
  return key;
}

export async function listWorkspaceTemplateSshKeys(workspaceTemplateId: string, file = workspaceTemplatesFile()): Promise<WorkspaceTemplateSshKeySummary[]> {
  const workspaceTemplate = findWorkspaceTemplateRecord(await readWorkspaceTemplateStore(file), workspaceTemplateId);
  return (workspaceTemplate.sshKeys ?? []).map(summary);
}

export async function createWorkspaceTemplateSshKey(workspaceTemplateId: string, privateKey: string, file = workspaceTemplatesFile(), keyFile?: string, name = ""): Promise<WorkspaceTemplateSshKeySummary> {
  if (!privateKey.trim()) throw new AgentsInTheCloudCoreError("invalid_arguments", "Private key is required");
  privateKey = privateKey.replace(/\r\n/g, "\n");
  return await updateWorkspaceTemplateStore(file, async (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, workspaceTemplateId);
    const id = randomUUID();
    const publicKey = await publicKeyFromPrivateKey(privateKey);
    const key = {
      id,
      projectId: workspaceTemplateId,
      name: name.trim(),
      keyType: publicKey.split(" ", 1)[0]!,
      createdAt: new Date().toISOString(),
      encryptedPrivateKey: await encryptWorkspaceTemplateValue(workspaceTemplateId, id, privateKey, keyFile),
    };
    workspaceTemplate.sshKeys ??= [];
    workspaceTemplate.sshKeys.push(key);
    return summary(key);
  });
}

export async function deriveWorkspaceTemplateSshPublicKey(workspaceTemplateId: string, keyId: string, file = workspaceTemplatesFile(), keyFile?: string): Promise<string> {
  const workspaceTemplate = findWorkspaceTemplateRecord(await readWorkspaceTemplateStore(file), workspaceTemplateId);
  const key = findSshKey(workspaceTemplate, keyId);
  return await publicKeyFromPrivateKey(await decryptWorkspaceTemplateValue(workspaceTemplateId, key.id, key.encryptedPrivateKey, keyFile));
}

export async function renameWorkspaceTemplateSshKey(workspaceTemplateId: string, keyId: string, name: string, file = workspaceTemplatesFile()): Promise<WorkspaceTemplateSshKeySummary> {
  return await updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, workspaceTemplateId);
    const key = findSshKey(workspaceTemplate, keyId);
    key.name = name.trim();
    return summary(key);
  });
}

export async function deleteWorkspaceTemplateSshKey(workspaceTemplateId: string, keyId: string, file = workspaceTemplatesFile()): Promise<WorkspaceTemplateSshKeySummary> {
  return await updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, workspaceTemplateId);
    const key = findSshKey(workspaceTemplate, keyId);
    workspaceTemplate.sshKeys = workspaceTemplate.sshKeys!.filter((candidate) => candidate !== key);
    return summary(key);
  });
}

export async function revealWorkspaceTemplateSshKeys(workspaceTemplateId: string, file = workspaceTemplatesFile(), keyFile?: string): Promise<string[]> {
  const workspaceTemplate = findWorkspaceTemplateRecord(await readWorkspaceTemplateStore(file), workspaceTemplateId);
  return await Promise.all((workspaceTemplate.sshKeys ?? []).map((key) => decryptWorkspaceTemplateValue(workspaceTemplateId, key.id, key.encryptedPrivateKey, keyFile)));
}
