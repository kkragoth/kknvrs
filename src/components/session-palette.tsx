import { useEffect, useState } from "react";
import type { Command } from "@/components/ui/command-palette.js";
import { CommandPalette } from "@/components/ui/command-palette.js";
import { listThreads, type LocalThreadSummary } from "@/lib/threads.js";
import { useChatStore } from "@/stores/chat-store.js";
import { useSessionUiStore } from "@/stores/session-ui-store.js";
import { useSessionStore } from "@/stores/session-store.js";

/** Searchable session picker: fuzzy-filter local threads for this agent,
 * resume one, or start a fresh session. Opened via /sessions. */
export function SessionPalette() {
    const open = useSessionUiStore((s) => s.paletteOpen);
    const setOpen = useSessionUiStore((s) => s.setPaletteOpen);
    const agentName = useSessionStore((s) => s.agentName);
    const [threads, setThreads] = useState<LocalThreadSummary[]>([]);

    useEffect(() => {
        if (!open) return;
        setThreads(listThreads(agentName));
    }, [open, agentName]);

    function startNewSession() {
        const session = useSessionStore.getState();
        const chat = useChatStore.getState();
        session.setThreadId("");
        chat.clearFeed();
        chat.pushSystem("New session — send a message to start a fresh thread.");
    }

    function resumeThread(id: string, title: string) {
        const session = useSessionStore.getState();
        const chat = useChatStore.getState();
        session.setThreadId(id);
        chat.clearFeed();
        chat.pushSystem(`Resumed thread ${id} — ${title}.`);
    }

    const currentThreadId = useSessionStore((s) => s.threadId);

    const commands: Command[] = [
        {
            id: "__new__",
            label: "+ New session",
            description: "start a fresh thread",
            group: "Actions",
            onSelect: () => startNewSession(),
        },
        ...threads.map((t) => ({
            id: `thread-${t.thread_id}`,
            label: `${t.thread_id === currentThreadId ? "* " : ""}#${t.thread_id.slice(-6)} ${t.title} (${t.message_count} msgs)`,
            description:
                t.thread_id === currentThreadId ? "current" : t.updated_at ? `updated ${t.updated_at}` : undefined,
            group: "Sessions",
            onSelect: () => resumeThread(t.thread_id, t.title),
        })),
    ];

    return (
        <CommandPalette
            isOpen={open}
            onClose={() => setOpen(false)}
            commands={commands}
            placeholder="Search sessions..."
            maxItems={50}
        />
    );
}
