import { create } from "zustand";
import { useChatStore } from "@/stores/chat-store.js";
import { useSessionStore } from "@/stores/session-store.js";
import { ConnectionStatus } from "@/lib/connection.js";

/** Boot state (no backend login — auth is per-MCP). Called once from main.tsx. */
interface AuthState {
    booted: boolean;
    error: string;
    setError: (error: string) => void;
    reset: () => void;
    boot: () => void;
    retryBoot: () => void;
}

let bootStarted = false;

export const useAuthStore = create<AuthState>()(() => ({
    booted: false,
    error: "",
    setError: (error) => useAuthStore.setState({ error }),
    reset: () => useAuthStore.setState({ booted: false, error: "" }),
    retryBoot: () => {
        bootStarted = false;
        useAuthStore.getState().boot();
    },
    boot: () => {
        if (bootStarted) return;
        bootStarted = true;
        void (async () => {
            const session = useSessionStore.getState();
            const chat = useChatStore.getState();
            if (session.configError) {
                useAuthStore.setState({ error: session.configError, booted: true });
                chat.pushSystem(session.configError);
                return;
            }
            const ok = await session.checkConnection();
            useAuthStore.setState({ booted: true });
            if (ok) {
                session.setConnection(ConnectionStatus.Connected);
                chat.pushSystem(
                    `Agent "${session.agentName || "(none)"}" · ${session.provider}:${session.model} · ollama ${session.ollamaBaseUrl}. Type /help for commands.`,
                );
            } else {
                chat.pushSystem(
                    `Ollama unreachable at ${session.ollamaBaseUrl} — start it (ollama serve), then send a message to retry.`,
                );
            }
        })();
    },
}));
