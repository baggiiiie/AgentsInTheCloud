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
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";

export type DurableConversationRecord = {
  conversationId: string;
  durableId: ConversationId;
  label: string;
  title: string;
};

/** Application identity is independent of Durable's storage-local numeric IDs. */
export const WorkspaceConversations = defineDoc<{
  workspaceId: string;
  conversations: DurableConversationRecord[];
}>({
  kind: "atelier.workspace",
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
  const release = await lock(directory);
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
