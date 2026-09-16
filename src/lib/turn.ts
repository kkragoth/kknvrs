import type { FeedItem, Turn } from "@/types.js";
import { TurnPhase } from "@/types.js";

/** Max options the server attaches to an ask_user event (mirrors backend MAX_ASK_OPTIONS). */
export const MAX_CLARIFICATION_OPTIONS = 4;

const CLARIFICATION_PICK_RE = new RegExp(`^[1-${MAX_CLARIFICATION_OPTIONS}]$`);

/** ADT predicates — compare against the TurnPhase enum, never raw strings. */

export function isWorkingTurn(turn: Turn): boolean {
    return turn.phase === TurnPhase.Working;
}

export function isTerminalPhase(phase: TurnPhase): boolean {
    switch (phase) {
        case TurnPhase.Done:
        case TurnPhase.Error:
        case TurnPhase.Cancelled:
            return true;
        case TurnPhase.Working:
            return false;
    }
}

export function turnPhaseLabel(turn: Turn): string {
    switch (turn.phase) {
        case TurnPhase.Done:
            if (turn.clarification) return "Waiting for your answer";
            return `Thought · ${turn.tools.length} tool call${turn.tools.length === 1 ? "" : "s"}`;
        case TurnPhase.Cancelled:
            return "Cancelled";
        case TurnPhase.Error:
            return "Failed";
        case TurnPhase.Working:
            return "Thinking";
    }
}

/** Factory + immutable transitions so call sites never build Turn literals. */

let nextTurnId = 1;

export function createTurn(userText: string): Turn {
    return {
        id: nextTurnId++,
        userText,
        answer: "",
        phase: TurnPhase.Working,
        tools: [],
        expanded: false,
        startedAt: Date.now(),
    };
}

export function nextSystemId(): number {
    return nextTurnId++;
}

export function nextQueueId(): number {
    return nextTurnId++;
}

export function completeTurnIfWorking(turn: Turn): Turn {
    if (!isWorkingTurn(turn)) return turn;
    return { ...turn, phase: TurnPhase.Done, endedAt: Date.now(), expanded: false };
}

export function failTurn(turn: Turn): Turn {
    return { ...turn, phase: TurnPhase.Error, endedAt: Date.now(), expanded: false };
}

export function cancelTurn(turn: Turn): Turn {
    return { ...turn, phase: TurnPhase.Cancelled, endedAt: Date.now(), expanded: false };
}

export function appendAnswer(turn: Turn, chunk: string): Turn {
    return { ...turn, answer: turn.answer + chunk };
}

export function setClarification(turn: Turn, question: string, options: string[]): Turn {
    const clean = options
        .map((o) => o.trim())
        .filter((o) => o.length > 0)
        .slice(0, MAX_CLARIFICATION_OPTIONS);
    return { ...turn, clarification: { question, options: clean } };
}

/** Drop an answered/superseded clarification so old turns stop advertising it. */
export function clearClarification(turn: Turn): Turn {
    if (!turn.clarification) return turn;
    const next = { ...turn };
    delete next.clarification;
    return next;
}

/** Resolve a numeric reply ("1"..MAX) against the newest turn's options.
 * Anything else passes through untouched — that IS the "other" path:
 * free text answering in the user's own words. Only the newest turn counts,
 * so a stale digit typed much later is never misresolved. */
export function resolveClarificationPick(feed: FeedItem[], text: string): string {
    const trimmed = text.trim();
    if (!CLARIFICATION_PICK_RE.test(trimmed)) return text;
    for (let i = feed.length - 1; i >= 0; i--) {
        const item = feed[i]!;
        if (item.kind !== "turn") continue;
        const options = item.turn.clarification?.options ?? [];
        if (options.length === 0) return text;
        return options[Number(trimmed) - 1] ?? text;
    }
    return text;
}
