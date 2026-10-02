import { mkdir } from "node:fs/promises";
import { lock } from "proper-lockfile";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  configure,
  defineDoc,
  Harness,
  type AgentChange,
  type ConversationId,
  type HarnessOptions,
} from "@earendil-works/pi-durable";
import { markGatedDurableWork, WorkspaceAdmission } from "./durable-lifecycle.ts";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";

export type DurableConversationRecord = {
  conversationId: string;
  durableId: ConversationId;
  label: string;
  title: string;
  readOnly?: boolean;
  /** Retained branch IDs; durableId is the selected immutable fork. */
  branches?: ConversationId[];
};

/** Application identity is independent of Durable's storage-local numeric IDs. */
export const WorkspaceConversations = defineDoc<{
  workspaceId: string;
  conversations: DurableConversationRecord[];
}>({
  kind: "agents-in-the-cloud.workspace",
  version: 1,
  scope: "session",
  initial: () => ({ workspaceId: "", conversations: [] }),
});

/**
 * One journal and scheduler per workspace, outside the disposable execution container.
 * Opening is passive: the host must make the workspace ready before resume or submit.
 * Closing suspends work; it is not the user's Stop action.
 */
export async function openDurableWorkspace(directory: string, workspaceId: string, options: HarnessOptions) {
  await mkdir(directory, { recursive: true });
  // Pi's JSONL backend has no writer exclusion. A compromised lease is fatal (the
  // lock library's default), rather than allowing two writers to corrupt history.
  // An immediate host restart must allow the previous writer's heartbeat to
  // expire. Wait a bounded 12 seconds (past the 10-second lease plus timestamp
  // rounding), but never remove a fresh lock or admit a concurrent writer.
  const release = await lock(directory, {
    stale: 10_000,
    update: 5_000,
    retries: { retries: 24, factor: 1, minTimeout: 500, maxTimeout: 500, randomize: false },
  });
  try {
    const storage = await openNodeJsonlStorage(directory, BACKGROUND_CONTEXT, { fsync: true });
    let harness: Harness;
    try {
      harness = await Harness.open(storage, options, BACKGROUND_CONTEXT);
    } catch (error) {
      await storage.close(BACKGROUND_CONTEXT);
      throw error;
    }
    try {
      await harness.commit(async (tx) => {
        const workspace = await tx.doc(WorkspaceConversations);
        if (workspace.workspaceId && workspace.workspaceId !== workspaceId) {
          throw new Error(`Journal belongs to workspace ${workspace.workspaceId}, not ${workspaceId}`);
        }
        workspace.workspaceId = workspaceId;
      }, BACKGROUND_CONTEXT);
      await markGatedDurableWork(harness);
    } catch (error) {
      await harness.close(BACKGROUND_CONTEXT);
      throw error;
    }
    let closing: Promise<void> | undefined;
    return {
      harness,
      /** Idempotent creation: catalog, conversation, and initial settings commit together. */
      async conversation(record: Omit<DurableConversationRecord, "durableId">, agent: AgentChange = {}) {
        const id = await harness.commit(async (tx) => {
          const workspace = await tx.doc(WorkspaceConversations);
          const existing = workspace.conversations.find((item) => item.conversationId === record.conversationId);
          if (existing) return existing.durableId;
          if ((await tx.doc(WorkspaceAdmission)).deleted) throw new Error("Durable workspace is deleted");
          const created = await tx.createConversation({ ownership: { kind: "ownerless" } });
          await configure(tx, created.id, agent);
          workspace.conversations.push({ ...record, durableId: created.id });
          return created.id;
        }, BACKGROUND_CONTEXT);
        return (await harness.conversation(id, BACKGROUND_CONTEXT))!;
      },
      close(): Promise<void> {
        return closing ??= (async () => {
          // Do not release the writer lease if storage shutdown fails.
          await harness.close(BACKGROUND_CONTEXT);
          await release();
        })();
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}

export type DurableWorkspace = Awaited<ReturnType<typeof openDurableWorkspace>>;
