import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AgentsInTheCloudCoreError, getAgentsInTheCloudRuntimeContext, isNotFoundError } from "@agents-in-the-cloud/core";

const keyBytes = 32;
const ivBytes = 12;

function workspaceTemplateSecretsKeyFile(dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): string {
  return join(dataDir, "project-secrets.key");
}

async function readOrCreateMasterKey(file: string): Promise<Buffer> {
  try {
    const key = Buffer.from((await readFile(file, "utf8")).trim(), "base64url");
    if (key.byteLength !== keyBytes) throw new AgentsInTheCloudCoreError("invalid_workspace_template_secret_key", `template secrets key must be ${keyBytes} bytes`);
    return key;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    const key = randomBytes(keyBytes);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${key.toString("base64url")}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(file, 0o600);
    return key;
  }
}

function aad(workspaceTemplateId: string, secretId: string): Buffer {
  return Buffer.from(`project-secret:${workspaceTemplateId}:${secretId}:v1`, "utf8");
}

export async function encryptWorkspaceTemplateValue(workspaceTemplateId: string, secretId: string, plaintext: string, keyFile = workspaceTemplateSecretsKeyFile()): Promise<string> {
  const key = await readOrCreateMasterKey(keyFile);
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(workspaceTemplateId, secretId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64url")}`;
}

export async function decryptWorkspaceTemplateValue(workspaceTemplateId: string, secretId: string, encryptedValue: string, keyFile = workspaceTemplateSecretsKeyFile()): Promise<string> {
  const [version, encodedIv, encodedPayload] = encryptedValue.split(":");
  if (version !== "v1" || !encodedIv || !encodedPayload) throw new AgentsInTheCloudCoreError("invalid_workspace_template_secret_ciphertext", `invalid template secret ciphertext: ${secretId}`);
  const payload = Buffer.from(encodedPayload, "base64url");
  if (payload.byteLength < 16) throw new AgentsInTheCloudCoreError("invalid_workspace_template_secret_ciphertext", `invalid template secret ciphertext: ${secretId}`);
  const decipher = createDecipheriv("aes-256-gcm", await readOrCreateMasterKey(keyFile), Buffer.from(encodedIv, "base64url"));
  decipher.setAAD(aad(workspaceTemplateId, secretId));
  decipher.setAuthTag(payload.subarray(-16));
  return Buffer.concat([decipher.update(payload.subarray(0, -16)), decipher.final()]).toString("utf8");
}
