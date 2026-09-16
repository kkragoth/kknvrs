import type { ToolStep, Turn } from "@/types.js";

/** Plain-text helpers shared by the transcript components and App. */

export function oneLine(text: string, max = 160): string {
    return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function toolSummary(tools: ToolStep[]): string {
    return toolSummaryLines(tools).join("\n");
}

/** One short header line per tool plus indented arg/output lines, so no
 * single row grows to 200+ chars and spills. Each line stays under ~100
 * chars and the ThinkingBlock renders lines separately (respects \n). */
export function toolSummaryLines(tools: ToolStep[]): string[] {
    if (tools.length === 0) return ["Answered directly, no tools used."];
    const lines: string[] = [];
    for (const t of tools) {
        const ms = t.elapsedMs !== undefined ? ` (${(t.elapsedMs / 1000).toFixed(1)}s)` : "";
        lines.push(`• ${t.tool}${ms}`);
        const argsStr = oneLine(JSON.stringify(t.args), 80);
        if (argsStr !== "{}" && argsStr !== "") {
            lines.push(`  args: ${argsStr}`);
        }
        if (t.output !== undefined) {
            for (const item of splitOutputLines(t.output)) {
                lines.push(`  → ${item}`);
            }
        } else {
            lines.push("  → …");
        }
    }
    return lines;
}

const MAX_OUTPUT_LINES = 6;
const MAX_OUTPUT_LINE_LEN = 90;

/** Split a tool result into short display lines: newlines and `•`
 * separators each start their own row, so listed items never run together
 * on one line that gets cut mid-item (e.g. `(ID: 7,`). Excess rows collapse
 * into a `… +N more` trailer. */
export function splitOutputLines(output: string): string[] {
    const items = output
        .split("\n")
        .flatMap((line) => line.split("•"))
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    if (items.length === 0) return [oneLine(output, MAX_OUTPUT_LINE_LEN)];
    const shown = items.slice(0, MAX_OUTPUT_LINES).map((s) => oneLine(s, MAX_OUTPUT_LINE_LEN));
    if (items.length > MAX_OUTPUT_LINES) {
        shown.push(`… +${items.length - MAX_OUTPUT_LINES} more`);
    }
    return shown;
}

/** Thinking-block line for a turn. An awaiting clarification beats the
 * empty "answered directly" line — the turn asked a question, it didn't answer. */
export function thinkingContent(turn: Turn, working: boolean): string {
    if (turn.clarification && turn.tools.length === 0) {
        return "Asked a clarifying question — reply with the number or your own answer.";
    }
    if (working && turn.tools.length === 0) return "Contacting model…";
    return toolSummary(turn.tools);
}

/** Runtime passes the input string; the prop type also merges a DOM
 * SubmitEvent arm that never fires — coerce defensively. */
export function submittedText(value: unknown): string {
    return typeof value === "string" ? value : "";
}

export function isThreadId(text: string): boolean {
    return /^\d+$/.test(text);
}
