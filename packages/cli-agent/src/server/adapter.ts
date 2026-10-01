import type { JsonObject } from "@atelier/core";
import type { TranscriptRecord } from "@atelier/agent/server";
import type { AgentLaunchFooterContext, AgentWorkspaceParameters, WorkspaceAgentInput } from "@atelier/shared";

/** Identity of the session being launched, so adapters can address their session-local files. */
export interface CliAgentSession {
  id: string;
  /** Existing session-private directory (umask 077) for the adapter's configuration files. */
  directory: string;
  /** Script the CLI must run at each turn boundary, already authorized for this session. */
  turnSignalCommand: string;
}

/** Provider-specific policy; the shared module owns sessions and terminal presentation. */
export interface CliAgentAdapter {
  /** Stable slug: also owns <id>-agents.json, <id>-agents routes and tmux names. */
  id: string;
  label: string;
  iconHtml: string;
  requireSetup(): Promise<void>;
  settings: {
    renderFooter(context: AgentLaunchFooterContext): Promise<string>;
    prepare(parameters?: JsonObject): Promise<AgentWorkspaceParameters>;
  };
  /** Refresh workspace configuration before a new or restored terminal launch. */
  prepareWorkspace?(workspaceId: string): Promise<void>;
  /** Session-local configuration; returned environment is passed only to its terminal. */
  prepareSession?(workspaceId: string, session: CliAgentSession, mcp: { url: string; token: string }): Promise<Record<string, string>>;
  /** Bash script with the CLI-specific flags and initial prompt. */
  launchScript(input: WorkspaceAgentInput, imagePaths: string[], settings: AgentWorkspaceParameters, session: CliAgentSession): string;
  /** Restore native context without submitting any prompt; an empty session opens idle. */
  resumeScript?(workspaceId: string, settings: AgentWorkspaceParameters, session: CliAgentSession): Promise<string>;
  /** Optional native-history adapter. CLI providers without one remain terminal-only. */
  loadTranscript?(workspaceId: string, sessionId: string): Promise<TranscriptRecord[] | undefined>;
  loadTranscriptImage?(workspaceId: string, sessionId: string, entryId: string, contentIndex: number): Promise<Response>;
}
