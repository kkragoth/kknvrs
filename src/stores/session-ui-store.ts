import { create } from "zustand";

/** UI state for the /sessions command-palette popup. Kept separate from the
 * connection session store so opening/closing never touches auth data. */
interface SessionUiState {
    paletteOpen: boolean;
    setPaletteOpen: (open: boolean) => void;
}

export const useSessionUiStore = create<SessionUiState>()((set) => ({
    paletteOpen: false,
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
