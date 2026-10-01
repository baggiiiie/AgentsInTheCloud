import { AtelierCoreError } from "@atelier/core";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { dirname } from "node:path";
import { workspaceRoot } from "@atelier/workspace";
import { BaseAgentRuntime } from "./base-agent-runtime.ts";
import { recordsFromSessionEntries } from "./session-records.ts";
import { buildTranscript } from "./transcript.ts";
import type { WorkspaceAgentConversationInfo } from "./session-store.ts";

/** Historical Pi files are readable, never resumed or migrated into a native root. */
export class LegacyAgentRuntime extends BaseAgentRuntime {
  private readonly records;
  constructor(agent: WorkspaceAgentConversationInfo) {
    super(agent);
    this.ctx.readOnly = true;
    const session = SessionManager.open(agent.path, dirname(agent.path), workspaceRoot);
    this.records = recordsFromSessionEntries(session.getBranch());
  }
  protected canonicalItems() { return buildTranscript(this.records).map(item => ({ ...item, rewindEntryId: undefined })); }
  protected modelContext() { return { systemPrompt: "", tools: [] }; }
  protected async statsView() { return { contextPercent: null, compactAvailable: false, inputTokens: 0, outputTokens: 0, cost: 0, modelName: undefined, thinkingLevel: "off", thinkingLevels: [], models: [] }; }
  override async paneState() { return { ...await super.paneState(), readOnly: true }; }
  currentModel() { return undefined; }
  currentThinkingLevel() { return "off"; }
  availableThinkingLevels() { return []; }
  userMessages() { return this.records.flatMap(record => record.kind === "user" ? [record.text] : []); }
  private readOnly(): never { throw new AtelierCoreError("invalid_arguments", "This conversation is read-only. Start a new Agent conversation to continue."); }
  async submit() { this.readOnly(); }
  async compact() { this.readOnly(); }
  async abort() { this.readOnly(); }
  async setModel() { this.readOnly(); }
  async setThinkingLevel() { this.readOnly(); }
  async rewind() { this.readOnly(); }
  treeHtml() { return '<p>This historical conversation is read-only.</p>'; }
  labelTreeEntry() { this.readOnly(); }
  async navigateTree(): Promise<string> { this.readOnly(); }
  async newSession() { this.readOnly(); }
  async dispose() { this.markDisposed(); }
}
