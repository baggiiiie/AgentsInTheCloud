import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDoc, InboxDoc, type ConversationId, type Cursor, type Harness, type TaskId, type Tx } from "@earendil-works/pi-durable";

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

/** Exact work at the Stop boundary, not a permanent conversation admission gate. */
export const WorkspaceStops = defineDoc<{ tasks: Record<string, TaskId[]> }>({
  kind: "atelier.stops", version: 1, scope: "session", initial: () => ({ tasks: {} }),
});

/** Commit intent and withdraw steering atomically, without enabling execution. */
export async function commitDurableStop(tx: Tx, conversationId: ConversationId) {
  const tasks: TaskId[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await tx.scanTasks({ conversationId }, 500, cursor);
    tasks.push(...page.items.filter(task => task.state.status !== "terminal").map(task => task.id));
    cursor = page.next;
  } while (cursor);
  const inbox = await tx.doc(InboxDoc, conversationId);
  for (const item of inbox.items) tx.settleSubmission(item.id, { status: "unanswered", reason: "aborted" });
  inbox.items = [];
  // Replacing a prior intent is safe: every still-live prior task is included.
  // Include background work: product Stop also stops owned receipt processes.
  (await tx.doc(WorkspaceStops)).tasks[String(conversationId)] = tasks;
}

/**
 * Passive recovery barrier. Never use Conversation.abort here: that enables the
 * whole scheduler before other closed conversations have been marked. All native
 * tools (including background/receipt tasks) retain their conversation ID. Live
 * delegation is deliberately not installed in this runtime.
 */
export async function markGatedDurableWork(harness: Harness) {
  const context = BACKGROUND_CONTEXT;
  const gates = await harness.snapshot(WorkspaceAdmission, context);
  const stops = await harness.snapshot(WorkspaceStops, context);
  const stopped = new Set(Object.values(stops?.tasks ?? {}).flat());
  if ((!gates || (!gates.deleted && gates.closed.length === 0)) && !stopped.size) return;
  const gated = (id: ConversationId) => gates?.deleted || gates?.closed.includes(id);
  const inspection = await harness.inspect(context);
  for (const submission of inspection.submissions) {
    if (gated(submission.conversationId)) await harness.abortSubmission(submission.id, context);
  }
  // Mark every task, including background work, before anything asks for progress.
  // abortTask commits a mark, then joins an existing invocation. Start every
  // mark before joining any one tool (which may itself be waiting on lifecycle).
  await Promise.all(inspection.tasks.filter(({ record }) => gated(record.conversationId) || stopped.has(record.id))
    .map(({ record }) => harness.abortTask(record.id, context)));
}

/** Readiness must precede this progress boundary; only join explicitly stopped work. */
export async function settleStoppedDurableWork(harness: Harness) {
  const stopped = new Set(Object.values((await harness.snapshot(WorkspaceStops, BACKGROUND_CONTEXT))?.tasks ?? {}).flat());
  if (!stopped.size) return;
  const inspection = await harness.inspect(BACKGROUND_CONTEXT);
  await Promise.all(inspection.tasks.filter(({ record }) => stopped.has(record.id))
    .map(({ record }) => harness.waitForTask(record.id, BACKGROUND_CONTEXT)));
}
