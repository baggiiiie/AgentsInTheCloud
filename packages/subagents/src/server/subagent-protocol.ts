export type AgentMessageInput = {
  type: "agent_message";
  author: string;
  recipient: string;
  content: { type: "input_text"; text: string }[];
};
export function parseForkTurns(value = "all"): string {
  const normalized = value.trim().toLowerCase() || "all";
  if (normalized === "all" || normalized === "none") return normalized;
  if (!/^\+?\d+$/.test(normalized) || !Number.isSafeInteger(Number(normalized)) || Number(normalized) < 1) throw new Error("fork_turns must be `none`, `all`, or a positive integer string");
  return String(Number(normalized));
}
