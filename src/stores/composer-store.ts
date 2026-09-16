import { create } from "zustand";

/** Message composer: draft text + completion cursor. Shared by MessageInput,
 * CommandPopup, and the App keyboard handler — no prop drilling. */
interface ComposerState {
    draft: string;
    completeIdx: number;
    setDraft: (draft: string) => void;
    setCompleteIdx: (idx: number) => void;
    cycleCompletion: (dir: 1 | -1, count: number) => void;
    acceptCompletion: (name: string) => void;
    clear: () => void;
}

export const useComposerStore = create<ComposerState>()((set) => ({
    draft: "",
    completeIdx: 0,
    setDraft: (draft) => set({ draft, completeIdx: 0 }),
    setCompleteIdx: (completeIdx) => set({ completeIdx }),
    cycleCompletion: (dir, count) =>
        set((s) => ({
            completeIdx: dir === 1 ? (s.completeIdx + 1) % count : (s.completeIdx - 1 + count) % count,
        })),
    acceptCompletion: (name) => set({ draft: `${name} `, completeIdx: 0 }),
    clear: () => set({ draft: "", completeIdx: 0 }),
}));
