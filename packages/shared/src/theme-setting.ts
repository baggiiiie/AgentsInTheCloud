import { readFileSync } from "node:fs";
import { agentsInTheCloudDataPath, getAgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import { updateJsonSettings } from "@agents-in-the-cloud/core/json-settings";
import { parseThemeSettings, type AgentsInTheCloudTheme } from "./theme.ts";

export { agentsInTheCloudThemes, isAgentsInTheCloudTheme, themeAppearance, type AgentsInTheCloudTheme } from "./theme.ts";

// AgentsInTheCloud System reads this file directly, so its location is part of that contract.
function themeSettingPath(): string {
  return agentsInTheCloudDataPath(getAgentsInTheCloudRuntimeContext(), "theme.json");
}

/** Synchronous because every page render embeds the theme. */
export function readThemeSetting(): AgentsInTheCloudTheme {
  let text: string | undefined;
  try {
    text = readFileSync(themeSettingPath(), "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  // An AgentsInTheCloud running inside a workspace looks different from the host by default.
  return parseThemeSettings(text, process.env.ATELIER_HOST_UID ? "cappuccino" : "nord");
}

export async function writeThemeSetting(theme: AgentsInTheCloudTheme): Promise<void> {
  await updateJsonSettings(themeSettingPath(), (settings) => { settings.theme = theme; });
}
