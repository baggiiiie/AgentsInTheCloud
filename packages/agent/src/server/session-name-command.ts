import { parseAgentSessionNameCommand } from "./prompt-templates.ts";

/** AgentsInTheCloud owns /name; providers supply only their conversation context and title store. */
export async function runAgentSessionNameCommand(text: string, options: {
  suggest: () => Promise<string | undefined>;
  setTitle: (title: string) => Promise<void>;
}): Promise<"named" | "no-title" | undefined> {
  const command = parseAgentSessionNameCommand(text);
  if (!command) return undefined;
  const title = command.title ?? await options.suggest();
  if (!title) return "no-title";
  await options.setTitle(title);
  return "named";
}
