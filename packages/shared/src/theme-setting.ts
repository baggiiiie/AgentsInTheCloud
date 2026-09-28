import { readFileSync } from "node:fs";
import { atelierDataPath, getAtelierRuntimeContext } from "@atelier/core";
import { updateJsonSettings } from "@atelier/core/json-settings";
import { parseThemeSettings, type AtelierTheme } from "./theme.ts";

export { atelierThemes, isAtelierTheme, themeAppearance, type AtelierTheme } from "./theme.ts";

// Atelier System reads this file directly, so its location is part of that contract.
function themeSettingPath(): string {
  return atelierDataPath(getAtelierRuntimeContext(), "theme.json");
}

/** Synchronous because every page render embeds the theme. */
export function readThemeSetting(): AtelierTheme {
  let text: string | undefined;
  try {
    text = readFileSync(themeSettingPath(), "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  // An Atelier running inside a workspace looks different from the host by default.
  return parseThemeSettings(text, process.env.ATELIER_HOST_UID ? "cappuccino" : "nord");
}

export async function writeThemeSetting(theme: AtelierTheme): Promise<void> {
  await updateJsonSettings(themeSettingPath(), (settings) => { settings.theme = theme; });
}
