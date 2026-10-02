import { agentsInTheCloudDataPath, getAgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import { readJsonSettings, updateJsonSettings } from "@agents-in-the-cloud/core/json-settings";
import { Value } from "typebox/value";
import { releaseChannelSchema, type ReleaseChannel } from "./channels.ts";

function settingsPath(): string {
  return agentsInTheCloudDataPath(getAgentsInTheCloudRuntimeContext(), "update.json");
}

export async function readStoredReleaseChannel(): Promise<ReleaseChannel | undefined> {
  const { releaseChannel } = await readJsonSettings(settingsPath());
  if (releaseChannel === undefined) return undefined;
  if (!Value.Check(releaseChannelSchema, releaseChannel)) throw new Error("Invalid update settings");
  return releaseChannel;
}

export async function writeStoredReleaseChannel(channel: ReleaseChannel): Promise<void> {
  await updateJsonSettings(settingsPath(), (settings) => { settings.releaseChannel = channel; });
}
