import type { FeedItem, TokenUsage } from "@/types.js";

/** Token accounting for model calls. Ollama reports prompt_eval_count
 * (input) + eval_count (output) per /api/chat step; a ReAct turn sums
 * every step so multi-tool turns report the true cost. */

export function emptyUsage(): TokenUsage {
    return { promptTokens: 0, completionTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
        promptTokens: Math.max(0, Math.floor(a.promptTokens + b.promptTokens)),
        completionTokens: Math.max(0, Math.floor(a.completionTokens + b.completionTokens)),
    };
}

export function totalUsage(u: TokenUsage): number {
    return u.promptTokens + u.completionTokens;
}

export function hasUsage(u: TokenUsage): boolean {
    return u.promptTokens > 0 || u.completionTokens > 0;
}

/** Compact count for tight TUI headers: 999 → "999", 1500 → "1.5k",
 * 2_000_000 → "2M". Trailing ".0" is trimmed ("2k", not "2.0k"). */
export function formatTokenCount(n: number): string {
    const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    if (v < 1000) return `${v}`;
    const trim = (x: number): string => {
        const s = x.toFixed(1);
        return s.endsWith(".0") ? s.slice(0, -2) : s;
    };
    if (v < 1_000_000) return `${trim(v / 1_000)}k`;
    if (v < 1_000_000_000) return `${trim(v / 1_000_000)}M`;
    return `${trim(v / 1_000_000_000)}B`;
}

/** Exact count for expanded views: 12345 → "12,345". */
export function formatTokenCountLong(n: number): string {
    const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    return v.toLocaleString("en-US");
}

/** One header segment, no "·" so callers can join with it:
 * "↑1.2k ↓800", or whichever side is non-zero, or "" when empty. */
export function formatUsageShort(u: TokenUsage): string {
    const parts: string[] = [];
    if (u.promptTokens > 0) parts.push(`↑${formatTokenCount(u.promptTokens)}`);
    if (u.completionTokens > 0) parts.push(`↓${formatTokenCount(u.completionTokens)}`);
    return parts.join(" ");
}

/** Verbose line for expanded views with exact counts. */
export function formatUsageLong(u: TokenUsage): string {
    return (
        `${formatTokenCountLong(u.promptTokens)} in · ` +
        `${formatTokenCountLong(u.completionTokens)} out · ` +
        `${formatTokenCountLong(totalUsage(u))} total`
    );
}

/** Sum usage across every turn in the feed (session total). */
export function sessionUsage(feed: FeedItem[]): TokenUsage {
    const total = emptyUsage();
    for (const item of feed) {
        if (item.kind !== "turn") continue;
        total.promptTokens += item.turn.tokens.promptTokens;
        total.completionTokens += item.turn.tokens.completionTokens;
    }
    return total;
}
