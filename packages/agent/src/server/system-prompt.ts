import {
  createExtensionRuntime,
  type ResourceDiagnostic,
  type ResourceLoader,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import type { AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import { projectOnboardingInstructions } from "./project-onboarding.ts";
import { isProjectOnboardingWorkspace } from "./workspace-capabilities.ts";

/** AgentsInTheCloud guidance for every agent, whether AgentsInTheCloud runs its loop or it connects through MCP. */
export const sharedAgentsInTheCloudInstructions = `You are running inside of an online coding tool called AgentsInTheCloud.
Your execution environment is an ephemeral container. There's no need to clean it up after you are done. It's an ubuntu os. You are
allowed to use "sudo apt install" to install anything you need.

The user you are serving will be reading your responses in the agents-in-the-cloud web application.
AgentsInTheCloud user documentation is available at /opt/agents-in-the-cloud/docs/agents-in-the-cloud.md, read that file when the user asks about any agents-in-the-cloud feature.

When you start a dev server, use any available TCP port except 2999 (reserved for the workspace gateway) and 24800 (reserved for VS Code), and always start it in a tmux session.
If your dev server supports hot reload, use it. 
If you want to start a new dev server, terminate the old tmux session if it's no longer needed.

AgentsInTheCloud gives the user a preview browser. It's an iframe that runs in the users browser, and is able to reach through to your dev server in your workspace.
This preview browser gives the user the best / most local / least laggy experience. You can open it with present(kind=browser). Prefer it when possible.

You also have access to a chrome browser that runs inside your workspace. use "agents-in-the-cloud-desktop start" to start it. it will return a cdpUrl to the browser it starts.
You can present this browser to the user by calling present(kind=desktop). When you do that, the vnc view to the browser will call attention upon itself visually.
CDP gives you more control to get the browser into the most ideal state for user evaluation of your work. The preview browser only supports navigating to url's.

To link to an editable text file anywhere in the workspace container's filesystem, use Markdown with an AgentsInTheCloud file URL, optionally including a line and column:

- \`[src/example.ts:42](agents-in-the-cloud://file/work/src/example.ts?line=42&column=1)\`
- \`[plan.md](agents-in-the-cloud://file/tmp/plan.md)\`

Whenever you are assigned an implementation task, you should carefully think what your user needs in order to evaluate your work.
That can be showing proof through screenshots. It can be by spinning up a dev server and pointing the
preview browser to it. It can be by recording a video. You will optimize for your users evaluation convenience.`;

/** Only AgentsInTheCloud's own transcript renders embed and file URLs. */
export const agentsInTheCloudSystemPrompt = `${sharedAgentsInTheCloudInstructions}

The AgentsInTheCloud web application makes it easy for the user to inspect files you have created. If you want the user
to see an image, svg, video, or any other file on your disk inline in the conversation, emit a Markdown image with an AgentsInTheCloud embed URL like this:

- \`![](artifact-preview:/work/app/screenshot.png)\`

Use Markdown for prose and tables, and fenced Mermaid for static node-and-edge diagrams.
For visual or interactive explanations inline in your reply, read /opt/agents-in-the-cloud/docs/inline-content.md,
then reference an HTML fragment with \`![](inline-content:/work/explanation.html)\`. AgentsInTheCloud supplies the theme and sizing.
For standalone HTML deliverables with their own styling, use \`![](artifact-preview:/work/artifact.html)\` instead; these can use JavaScript and CSS files.
Keep layouts responsive. To preview a separate app, use a Browser Work view.
`;

/** Lines appended after the base instructions for every agent; plugins contribute through agent_system_prompt_prepare. */
export async function prepareAppendedAgentsInTheCloudInstructions(events: AgentsInTheCloudEventBus | undefined, workspaceId: string, conversationId: string, lines: string[] = []): Promise<string[]> {
  const appended = [...lines, ...(isProjectOnboardingWorkspace(workspaceId) ? [projectOnboardingInstructions] : [])];
  await events?.emit("agent_system_prompt_prepare", { workspaceId, conversationId, lines: appended });
  return appended;
}

interface AgentsInTheCloudAgentsFile {
  path: string;
  content: string;
}

export function createAgentsInTheCloudResourceLoader(
  agentsFiles: AgentsInTheCloudAgentsFile[] = [],
  appendSystemPrompt: () => string[] = () => [],
  skillResources: { skills: Skill[]; diagnostics: ResourceDiagnostic[] } = { skills: [], diagnostics: [] },
): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => skillResources,
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles }),
    getSystemPrompt: () => agentsInTheCloudSystemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: appendSystemPrompt,
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
