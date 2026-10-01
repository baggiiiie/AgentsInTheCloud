import type { AgentSessionEvent, ExtensionEvent } from "@earendil-works/pi-coding-agent";

// Session events are reviewed in the runtime switch. Remaining extension-only
// hooks are silent: internal, already represented, or unsupported (including UI prompts).
type SilentExtensionEvent =
  | "project_trust"
  | "resources_discover"
  | "session_start"
  | "session_before_switch"
  | "session_before_fork"
  | "session_before_compact"
  | "session_compact"
  | "session_compact_failed"
  | "session_shutdown"
  | "session_before_tree"
  | "context"
  | "context_with_system"
  | "before_provider_request"
  | "before_provider_headers"
  | "provider_stream_event"
  | "before_agent_start"
  | "agent_before_settle"
  | "ui_prompt_start"
  | "ui_prompt_end"
  | "model_select"
  | "thinking_level_select"
  | "user_bash"
  | "input"
  | "tool_call"
  | "tool_result";

// Observed without installing policy-changing extension handlers.
type ObservedExtensionEvent = "mcp_servers_change" | "cache_warming_decision" | "session_tree"
  // Observed through Pi's response callback; the extension event itself is gated.
  | "after_provider_response";

type ExtensionOnlyEvent = Exclude<ExtensionEvent["type"], AgentSessionEvent["type"]>;
type AssertNever<Event extends never> = Event;

// Type-only: additions and stale entries fail `bun run check`; no runtime map.
export type PiExtensionEventReview = AssertNever<
  Exclude<ExtensionOnlyEvent, SilentExtensionEvent | ObservedExtensionEvent>
  | Exclude<SilentExtensionEvent | ObservedExtensionEvent, ExtensionOnlyEvent>
>;
