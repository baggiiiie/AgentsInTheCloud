import { Type } from "typebox";
import { Value } from "typebox/value";

/** Atelier's UI themes. design-system.css defines each one as a [data-theme] rule. */
export const atelierThemes = [
  { id: "daylight", label: "Daylight", appearance: "light" },
  { id: "cappuccino", label: "Cappuccino", appearance: "dark" },
  { id: "tokyo-night", label: "Tokyo Night", appearance: "dark" },
  { id: "midnight", label: "Midnight", appearance: "dark" },
  { id: "nord", label: "Nord", appearance: "dark" },
] as const;

export type AtelierTheme = (typeof atelierThemes)[number]["id"];

export function isAtelierTheme(value: unknown): value is AtelierTheme {
  return atelierThemes.some((theme) => theme.id === value);
}

export function themeAppearance(theme: AtelierTheme): "light" | "dark" {
  return atelierThemes.find(({ id }) => id === theme)!.appearance;
}

const themeSettingsSchema = Type.Object({ theme: Type.Optional(Type.String()) });

/** Parse the app's theme.json, which Atelier System also reads. `undefined` means no file. */
export function parseThemeSettings(text: string | undefined, fallback: AtelierTheme): AtelierTheme {
  const settings: unknown = text === undefined ? {} : JSON.parse(text);
  if (!Value.Check(themeSettingsSchema, settings)) throw new Error("Invalid theme settings");
  // A theme removed by a later release must not break page rendering.
  return isAtelierTheme(settings.theme) ? settings.theme : fallback;
}
