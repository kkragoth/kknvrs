import { create } from "zustand";

/** Message composer: draft text + completion cursor + sent history.
 * Shared by MessageInput, CommandPopup, and the App keyboard handler —
 * no prop drilling. */
interface ComposerState {
    draft: string;
    completeIdx: number;
    /** Submitted messages, newest last. Up/down cycles when input is single-line. */
    history: string[];
    /** -1 = live draft, otherwise index into history. */
    histIdx: number;
    setDraft: (draft: string) => void;
    setCompleteIdx: (idx: number) => void;
    cycleCompletion: (dir: 1 | -1, count: number) => void;
    acceptCompletion: (name: string) => void;
    pushHistory: (text: string) => void;
    cycleHistory: (dir: 1 | -1) => string | null;
    resetHistoryNav: () => void;
    clear: () => void;
}

export const useComposerStore = create<ComposerState>()((set, get) => ({
    draft: "",
    completeIdx: 0,
    history: [],
    histIdx: -1,
    setDraft: (draft) => set({ draft, completeIdx: 0, histIdx: -1 }),
    setCompleteIdx: (completeIdx) => set({ completeIdx }),
    cycleCompletion: (dir, count) =>
        set((s) => ({
            completeIdx: dir === 1 ? (s.completeIdx + 1) % count : (s.completeIdx - 1 + count) % count,
        })),
    acceptCompletion: (name) => set({ draft: `${name} `, completeIdx: 0 }),
    pushHistory: (text) =>
        set((s) => {
            const trimmed = text.trim();
            if (!trimmed) return s;
            if (s.history[s.history.length - 1] === trimmed) return { histIdx: -1 };
            const history = [...s.history, trimmed].slice(-100);
            return { history, histIdx: -1 };
        }),
    cycleHistory: (dir) => {
        const { history, histIdx } = get();
        if (history.length === 0) return null;
        let next: number;
        if (histIdx === -1) {
            if (dir !== -1) return null;
            next = history.length - 1;
        } else {
            next = histIdx + (dir === -1 ? -1 : 1);
            if (next < 0) next = 0;
            if (next >= history.length) {
                set({ histIdx: -1 });
                return "";
            }
        }
        set({ histIdx: next, draft: history[next] ?? "", completeIdx: 0 });
        return history[next] ?? null;
    },
    resetHistoryNav: () => set({ histIdx: -1 }),
    clear: () => set({ draft: "", completeIdx: 0, histIdx: -1 }),
}));
