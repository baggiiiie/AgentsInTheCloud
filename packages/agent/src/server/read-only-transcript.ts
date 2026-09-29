import type { AgentRenderContext } from "./render-context.ts";
import { renderTranscriptItem, renderTranscriptItemDetailFrame } from "./render-transcript.ts";
import { buildTranscript, findTranscriptItem, type TranscriptRecord } from "./transcript.ts";

/** External agent history shares the transcript presentation, not the built-in agent runtime. */
export function renderReadOnlyTranscript(ctx: AgentRenderContext, records: TranscriptRecord[], openEnded = false): string {
  const view = { ...ctx, readOnly: true };
  return buildTranscript(records, { openEnded }).map((item) => renderTranscriptItem(view, item)).join("");
}

export function renderReadOnlyTranscriptDetail(ctx: AgentRenderContext, records: TranscriptRecord[], key: string, count: number, openEnded = false): string | undefined {
  const item = findTranscriptItem(buildTranscript(records, { openEnded }), key);
  return item ? renderTranscriptItemDetailFrame({ ...ctx, readOnly: true }, item, { count }) : undefined;
}
