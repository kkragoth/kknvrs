/** Pure slash-command parsing. Execution lives in lib/slash-commands.ts. */
import type { SlashCommand } from "@/types.js";
import { SLASH_COMMANDS } from "@/types.js";

export interface SlashInvocation {
    name: string;
    arg: string;
}

export function parseSlash(raw: string): SlashInvocation | null {
    if (!raw.startsWith("/")) return null;
    const [cmd, ...rest] = raw.slice(1).split(/\s+/);
    return { name: (cmd ?? "").toLowerCase(), arg: rest.join(" ").trim() };
}

/** Completions while typing the command word itself (no args yet). */
export function getSlashCompletions(draft: string): SlashCommand[] {
    if (!draft.startsWith("/") || draft.slice(1).includes(" ")) return [];
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(draft.toLowerCase()));
}
