import { agentsInTheCloudDataPath, getAgentsInTheCloudRuntimeContext, type JsonObject } from "@agents-in-the-cloud/core";
import { readJsonSettings, updateJsonSettings } from "@agents-in-the-cloud/core/json-settings";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  defaultReviewSettings,
  type ReviewDiffLayout,
  type ReviewSettings,
  type ReviewViewport,
} from "../model.ts";

const diffLayoutSchema = Type.Union([Type.Literal("unified"), Type.Literal("side-by-side")]);
const settingsSchema = Type.Object({
  mobile: diffLayoutSchema,
  desktop: diffLayoutSchema,
  highlighting: Type.Optional(Type.Union([Type.Literal("line"), Type.Literal("word")])),
  overflow: Type.Optional(Type.Union([Type.Literal("scroll"), Type.Literal("wrap")])),
});

function settingsPath(): string {
  return agentsInTheCloudDataPath(getAgentsInTheCloudRuntimeContext(), "review-settings.json");
}

export function isReviewDiffLayout(value: string): value is ReviewDiffLayout {
  return value === "unified" || value === "side-by-side";
}

export function isReviewViewport(value: string): value is ReviewViewport {
  return value === "mobile" || value === "desktop";
}

function parseReviewSettings(settings: JsonObject): ReviewSettings {
  const stored: JsonObject = { ...defaultReviewSettings, ...settings };
  // Earlier saved settings used the diff library's layout name.
  if (stored.mobile === "split") stored.mobile = "side-by-side";
  if (stored.desktop === "split") stored.desktop = "side-by-side";
  return { ...defaultReviewSettings, ...Value.Parse(settingsSchema, stored) };
}

export async function readReviewSettings(path = settingsPath()): Promise<ReviewSettings> {
  return parseReviewSettings(await readJsonSettings(path));
}

export async function updateReviewSettings(update: Partial<ReviewSettings>, path = settingsPath()): Promise<void> {
  await updateJsonSettings(path, (settings) => {
    Object.assign(settings, parseReviewSettings(settings), update);
  });
}
