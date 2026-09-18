import type { TextareaRenderable } from "@opentui/core";
import type { RefObject } from "react";
import { useTheme } from "@/hooks/use-theme.js";
import { submitChatText } from "@/lib/chat-turn.js";
import { handleSlashCommand } from "@/lib/slash-commands.js";
import { useChatStore } from "@/stores/chat-store.js";
import { useComposerStore } from "@/stores/composer-store.js";
import { useSessionUiStore } from "@/stores/session-ui-store.js";

/** Multiline message box: enter sends, ctrl+j inserts a newline, up/down
 * cycles sent history when single-line. Ref is owned by App. */
export function MessageInput({ inputRef }: { inputRef: RefObject<TextareaRenderable | null> }) {
    const theme = useTheme();
    const busy = useChatStore((s) => s.busy);
    const queue = useChatStore((s) => s.queue);
    const paletteOpen = useSessionUiStore((s) => s.paletteOpen);

    function handleSubmit() {
        const raw = inputRef.current?.plainText ?? "";
        const text = raw.trim();
        inputRef.current?.clear();
        useComposerStore.getState().clear();
        if (!text) return;
        useComposerStore.getState().pushHistory(text);
        if (text.startsWith("/")) {
            void handleSlashCommand(text);
            return;
        }
        // Plain text always goes to the active agent's in-CLI ReAct loop.
        // Direct MCP calls (bypassing the LLM) stay on /call.
        submitChatText(text);
    }

    function handleContentChange() {
        const plain = inputRef.current?.plainText ?? "";
        useComposerStore.getState().setDraft(plain);
    }

    return (
        <>
            <box
                title={queue.length > 0 ? `Message — ${queue.length} queued` : "Message (/ for commands)"}
                border
                style={{ height: 6 }}
            >
                <textarea
                    ref={inputRef}
                    placeholder="Ask the agent to test something…"
                    focused={!paletteOpen}
                    selectionBg={theme.colors.selection}
                    selectionFg={theme.colors.selectionForeground}
                    onContentChange={handleContentChange}
                    onSubmit={handleSubmit}
                    keyBindings={[
                        { name: "return", action: "submit" },
                        { name: "kpenter", action: "submit" },
                        { name: "j", ctrl: true, action: "newline" },
                    ]}
                />
            </box>
            <text fg="gray">
                {busy ? "enter send (queues) · " : "enter send · "}ctrl+j newline · up/down history · esc cancel ·
                ctrl+t tools · pgup/pgdn scroll · drag text = copy · /quit exits
            </text>
        </>
    );
}
