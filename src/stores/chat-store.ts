import { create } from "zustand";
import type { FeedItem, Turn } from "@/types.js";
import { clearClarification, nextQueueId, nextSystemId } from "@/lib/turn.js";

export interface QueuedMessage {
    id: number;
    text: string;
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** Global chat transcript + turn lifecycle. Components subscribe to slices;
 * orchestration (SSE loop, slash commands) lives in hooks, never in views. */
interface ChatState {
    feed: FeedItem[];
    queue: QueuedMessage[];
    busy: boolean;
    status: string;
    pushSystem: (text: string) => void;
    pushTurn: (turn: Turn) => void;
    updateTurn: (id: number, fn: (turn: Turn) => Turn) => void;
    /** Clear clarification flags on all turns except `exceptId` (answered/superseded). */
    markClarificationsAnswered: (exceptId: number) => void;
    enqueue: (text: string) => void;
    takeNextQueued: () => QueuedMessage | undefined;
    toggleLastThinking: () => void;
    toggleTurnExpanded: (id: number) => void;
    clearFeed: () => void;
    setBusy: (busy: boolean) => void;
    setStatus: (status: string) => void;
    flash: string;
    flashMessage: (text: string) => void;
    clearFlash: () => void;
}

export const useChatStore = create<ChatState>()((set, get) => ({
    feed: [],
    queue: [],
    busy: false,
    status: "Ready.",
    pushSystem: (text) => set((s) => ({ feed: [...s.feed, { kind: "system", id: nextSystemId(), text }] })),
    pushTurn: (turn) => set((s) => ({ feed: [...s.feed, { kind: "turn", turn }] })),
    updateTurn: (id, fn) =>
        set((s) => ({
            feed: s.feed.map((item) =>
                item.kind === "turn" && item.turn.id === id ? { ...item, turn: fn(item.turn) } : item,
            ),
        })),
    markClarificationsAnswered: (exceptId) =>
        set((s) => ({
            feed: s.feed.map((item) =>
                item.kind === "turn" && item.turn.id !== exceptId
                    ? { ...item, turn: clearClarification(item.turn) }
                    : item,
            ),
        })),
    enqueue: (text) => {
        const id = nextQueueId();
        set((s) => ({
            queue: [...s.queue, { id, text }],
            feed: [...s.feed, { kind: "queued", id, text }],
            status: `Working… · Queued (${s.queue.length + 1})`,
        }));
    },
    takeNextQueued: () => {
        const next = get().queue[0];
        if (!next) return undefined;
        set((s) => ({
            queue: s.queue.slice(1),
            feed: s.feed.filter((item) => !(item.kind === "queued" && item.id === next.id)),
        }));
        return next;
    },
    toggleTurnExpanded: (id) =>
        set((s) => ({
            feed: s.feed.map((item) =>
                item.kind === "turn" && item.turn.id === id
                    ? { ...item, turn: { ...item.turn, expanded: !item.turn.expanded } }
                    : item,
            ),
        })),
    toggleLastThinking: () =>
        set((s) => {
            let target = -1;
            for (let i = s.feed.length - 1; i >= 0; i--) {
                const item = s.feed[i]!;
                if (item.kind === "turn" && item.turn.tools.length > 0) {
                    target = i;
                    break;
                }
            }
            if (target < 0) return s;
            return {
                feed: s.feed.map((item, i) =>
                    item.kind === "turn" && i === target
                        ? { ...item, turn: { ...item.turn, expanded: !item.turn.expanded } }
                        : item,
                ),
            };
        }),
    clearFeed: () => set({ feed: [] }),
    setBusy: (busy: boolean) => set({ busy }),
    setStatus: (status: string) => set({ status }),
    flash: "",
    flashMessage: (text: string) => {
        if (flashTimer) clearTimeout(flashTimer);
        set({ flash: text });
        flashTimer = setTimeout(() => useChatStore.getState().clearFlash(), 2500);
    },
    clearFlash: () => set({ flash: "" }),
}));
