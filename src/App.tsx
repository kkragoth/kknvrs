import { useRef } from "react";
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/react";
import { CommandPopup } from "@/components/command-popup.js";
import { HeaderBar } from "@/components/header-bar.js";
import { MessageInput } from "@/components/message-input.js";
import { SessionPalette } from "@/components/session-palette.js";
import { StatusLine } from "@/components/status-line.js";
import { Transcript } from "@/components/transcript.js";
import { cancelTurnRequest, isTurnRunning } from "@/lib/chat-turn.js";
import { getSlashCompletions } from "@/lib/slash.js";
import { useChatStore } from "@/stores/chat-store.js";
import { useComposerStore } from "@/stores/composer-store.js";
import { useSessionUiStore } from "@/stores/session-ui-store.js";

/** Pure composition over stores. Screen sections are self-contained components
 * under src/components/; this file owns only the two TUI refs, global key
 * handling, and drag-to-copy. No business logic lives here. */
export function App() {
    const renderer = useRenderer();
    const { width, height } = useTerminalDimensions();

    const inputRef = useRef<InputRenderable>(null);
    const scrollRef = useRef<ScrollBoxRenderable>(null);
    // Down position of a potential click; cleared on drag so drag-to-copy
    // never steals focus back to the input.
    const mouseDownPos = useRef<{ x: number; y: number; button: number } | null>(null);

    // Drag-to-select on any selectable message text copies via OSC52.
    useSelectionHandler((selection) => {
        const text = selection.getSelectedText();
        if (!text || !text.trim()) return;
        let ok = false;
        try {
            ok = renderer.copyToClipboardOSC52(text);
        } catch {
            ok = false;
        }
        useChatStore
            .getState()
            .flashMessage(ok ? `Copied ${text.length} chars` : "Copy unsupported here — try Opt/Alt+drag");
    });

    useKeyboard((key) => {
        const chat = useChatStore.getState();
        const composer = useComposerStore.getState();
        // The sessions palette owns the keyboard while open (it handles
        // ↑↓/enter/esc itself) so global shortcuts don't double-fire.
        if (useSessionUiStore.getState().paletteOpen) {
            return;
        }
        const matches = getSlashCompletions(composer.draft);
        const showPopup = matches.length > 0;
        const activeMatch = matches[Math.min(composer.completeIdx, Math.max(matches.length - 1, 0))];
        if (key.name === "escape") {
            if (showPopup) {
                composer.clear();
                if (inputRef.current) inputRef.current.value = "";
                return;
            }
            if (isTurnRunning()) {
                cancelTurnRequest();
                chat.setStatus("Cancelling turn… (esc)");
            }
            return;
        }
        if (key.name === "tab" && showPopup && activeMatch) {
            if (inputRef.current) inputRef.current.value = `${activeMatch.name} `;
            composer.acceptCompletion(activeMatch.name);
            return;
        }
        if (key.name === "tab") {
            inputRef.current?.focus();
            key.preventDefault();
            key.stopPropagation();
            return;
        }
        if ((key.name === "up" || key.name === "down") && showPopup) {
            composer.cycleCompletion(key.name === "up" ? -1 : 1, matches.length);
            return;
        }
        if ((key.ctrl ?? false) && key.name === "t") {
            chat.toggleLastThinking();
            return;
        }
        if (key.name === "pageup" || key.name === "page_up") {
            scrollRef.current?.scrollBy({ x: 0, y: -1 }, "viewport");
            return;
        }
        if (key.name === "pagedown" || key.name === "page_down") {
            scrollRef.current?.scrollBy({ x: 0, y: 1 }, "viewport");
        }
    });

    return (
        <box
            flexDirection="column"
            style={{ width, height }}
            onMouseDown={(e) => {
                mouseDownPos.current = { x: e.x, y: e.y, button: e.button };
            }}
            onMouseDrag={() => {
                mouseDownPos.current = null;
            }}
            onMouseUp={(e) => {
                const down = mouseDownPos.current;
                mouseDownPos.current = null;
                if (!down) return;
                if (down.button !== 0 || e.button !== 0) return;
                if (down.x !== e.x || down.y !== e.y) return;
                inputRef.current?.focus();
            }}
        >
            <HeaderBar />
            <scrollbox
                ref={scrollRef}
                stickyScroll
                stickyStart="bottom"
                style={{ flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}
            >
                <Transcript />
            </scrollbox>
            <CommandPopup />
            <SessionPalette />
            <StatusLine />
            <MessageInput inputRef={inputRef} />
        </box>
    );
}
