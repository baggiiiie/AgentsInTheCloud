import type { AgentSessionEvent, ExtensionEvent } from "@earendil-works/pi-coding-agent";

// The runtime switch reviews session events. Only extension-only hooks need a
// separate inventory while we decide, one by one, whether to surface them.
type PendingExtensionEvent =
  | "project_trust"
  | "resources_discover"
  | "mcp_servers_change"
  | "session_start"
  | "session_before_switch"
  | "session_before_fork"
  | "session_before_compact"
  | "session_compact"
  | "session_compact_failed"
  | "session_shutdown"
  | "session_before_tree"
  | "session_tree"
  | "context"
  | "context_with_system"
  | "cache_warming_decision"
  | "before_provider_request"
  | "before_provider_headers"
  | "after_provider_response"
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

type ExtensionOnlyEvent = Exclude<ExtensionEvent["type"], AgentSessionEvent["type"]>;
type AssertNever<Event extends never> = Event;

// Type-only: additions and stale entries fail `bun run check`; no runtime map.
export type PiExtensionEventReview = AssertNever<
  Exclude<ExtensionOnlyEvent, PendingExtensionEvent> | Exclude<PendingExtensionEvent, ExtensionOnlyEvent>
>;
