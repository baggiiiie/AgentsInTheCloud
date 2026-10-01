import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDoc, type ConversationId, type Harness } from "@earendil-works/pi-durable";

/** Separate from the identity catalog: existing journals start with open admission. */
export const WorkspaceAdmission = defineDoc<{
  deleted: boolean;
  closed: ConversationId[];
}>({
  kind: "atelier.admission",
  version: 1,
  scope: "session",
  initial: () => ({ deleted: false, closed: [] }),
});

/**
 * Passive recovery barrier. Never use Conversation.abort here: that enables the
 * whole scheduler before other closed conversations have been marked. All native
 * tools (including background/receipt tasks) retain their conversation ID. Live
 * delegation is deliberately not installed in this runtime.
 */
export async function markGatedDurableWork(harness: Harness) {
  const context = BACKGROUND_CONTEXT;
  const gates = await harness.snapshot(WorkspaceAdmission, context);
  if (!gates || (!gates.deleted && gates.closed.length === 0)) return;
  const gated = (id: ConversationId) => gates.deleted || gates.closed.includes(id);
  const inspection = await harness.inspect(context);
  for (const submission of inspection.submissions) {
    if (gated(submission.conversationId)) await harness.abortSubmission(submission.id, context);
  }
  // Mark every task, including background work, before anything asks for progress.
  for (const { record } of inspection.tasks) {
    if (gated(record.conversationId)) await harness.abortTask(record.id, context);
  }
}
