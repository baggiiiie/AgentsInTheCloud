import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { agentsInTheCloudDataPath, getAgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import { turboStream, turboStreamResponse } from "@agents-in-the-cloud/shared";

function completionPath(): string { return agentsInTheCloudDataPath(getAgentsInTheCloudRuntimeContext(), "onboarding-completed"); }

export async function onboardingCompleted(): Promise<boolean> {
  return Bun.file(completionPath()).exists();
}

export async function finishOnboarding(): Promise<Response> {
  const path = completionPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "completed\n");
  return turboStreamResponse(turboStream("remove", "onboarding_dialog"));
}

export async function resetOnboarding(): Promise<void> {
  await rm(completionPath(), { force: true });
}
