import { createCliModelSettings, type CliModelSettings } from "@agents-in-the-cloud/cli-agent/server";
import { piCliModelUnavailableReason } from "./pi-cli-bridge.ts";
import type { JsonObject } from "@agents-in-the-cloud/core";
import { piModelSetupRequired } from "./auth.ts";

const sharedSettings = createCliModelSettings({
  agentTypeId: "pi", label: "Pi",
  // Pi uses its own abstract thinking levels, not the provider-native efforts.
  effort: (level) => level,
  unavailableReason: piCliModelUnavailableReason,
});

async function preparePiModelSettings(parameters: JsonObject = {}): Promise<CliModelSettings> {
  const settings = await sharedSettings.prepare(parameters);
  if (!settings.model) throw piModelSetupRequired();
  return settings;
}

export const piModelSettings = { ...sharedSettings, prepare: preparePiModelSettings };
