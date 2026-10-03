import { readFile } from "node:fs/promises";
import { isNotFoundError, writeJsonAtomic } from "./fs.ts";
import { createKeyedOperationQueue } from "./keyed-operation-queue.ts";
import { isJsonObject } from "./json-request.ts";
import type { JsonObject } from "./json.ts";

const serialize = createKeyedOperationQueue();

export async function readJsonSettings(path: string): Promise<JsonObject> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isJsonObject(value)) throw new Error(`${path} must contain a JSON object`);
    return value;
  } catch (error) {
    if (isNotFoundError(error)) return {};
    throw error;
  }
}

export async function updateJsonSettings(path: string, update: (settings: JsonObject) => void | false): Promise<void> {
  await serialize(path, async () => {
    const settings = await readJsonSettings(path);
    if (update(settings) === false) return;
    await writeJsonAtomic(path, settings);
  });
}
