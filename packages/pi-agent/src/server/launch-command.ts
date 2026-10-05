import { parseModelRef } from "@agents-in-the-cloud/llm/server";
import { cliLaunchScript, cliPromptText, writeFileScript, type CliAgentSession, type CliModelSettings } from "@agents-in-the-cloud/cli-agent/server";
import type { WorkspaceAgentInput } from "@agents-in-the-cloud/shared";
import { piAgentsInTheCloudExtensionPath } from "./session.ts";
import { piAgentsInTheCloudTheme, piThemeName } from "./theme.ts";

/** Install and launch latest Pi, independent of the Pi libraries AgentsInTheCloud embeds. */
export function piLaunchScript(input: WorkspaceAgentInput, imagePaths: string[], settings: CliModelSettings, session: CliAgentSession, resumePath?: string): string {
  const prompt = cliPromptText(input);
  const model = settings.model ? parseModelRef(settings.model)! : undefined;
  // Pi treats @-prefixed positionals as file attachments even after --.
  const message = prompt.startsWith("@") ? `\n${prompt}` : prompt;
  const args = ["--approve", "--offline", "--use-theme", piThemeName, "--tui-mode", "regular", "--session-dir", `/home/agents-in-the-cloud/.local/share/pi/sessions/${session.id}`,
    ...(resumePath ? ["--session", resumePath] : []),
    "--extension", piAgentsInTheCloudExtensionPath(session),
    ...(model ? ["--provider", model.provider, "--model", model.id] : []),
    ...(settings.thinkingLevel ? ["--thinking", settings.thinkingLevel] : []),
    "--", ...imagePaths.map((path) => `@${path}`), ...(message ? [message] : [])];
  // Pi discovers themes in its agent directory, which AgentsInTheCloud manages.
  const setup = writeFileScript(`"$HOME/.pi/agent/themes/${piThemeName}.json"`, JSON.stringify(piAgentsInTheCloudTheme(), null, 2));
  return cliLaunchScript({ executable: "pi", label: "Pi", npmPackage: "@earendil-works/pi-coding-agent", args, setup });
}
