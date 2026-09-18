/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";

import { useTheme } from "@/hooks/use-theme";

export interface Command {
    id: string;
    label: string;
    description?: string;
    shortcut?: string;
    onSelect?: () => void;
    group?: string;
}

export interface CommandPaletteProps {
    commands: Command[];
    isOpen: boolean;
    onClose?: () => void;
    placeholder?: string;
    maxItems?: number;
}

function haystack(c: Command): string {
    return `${c.label} ${c.description ?? ""}`;
}

function fuzzyMatch(str: string, query: string): boolean {
    if (!query) {
        return true;
    }
    const s = str.toLowerCase();
    const q = query.toLowerCase();
    let qi = 0;
    for (let i = 0; i < s.length && qi < q.length; i += 1) {
        if (s[i] === q[qi]) {
            qi += 1;
        }
    }
    return qi === q.length;
}

function fuzzyScore(str: string, query: string): number {
    if (!query) {
        return 0;
    }
    const s = str.toLowerCase();
    const q = query.toLowerCase();
    let score = 0;
    let qi = 0;
    let lastMatchIdx = -1;

    for (let i = 0; i < s.length && qi < q.length; i += 1) {
        if (s[i] === q[qi]) {
            score += i - lastMatchIdx - 1;
            lastMatchIdx = i;
            qi += 1;
        }
    }

    return score;
}

/** Fullscreen session/command picker: fuzzy-search overlay (up/down navigate,
 * enter selects, esc closes). Single text node per row + ASCII-only markers
 * so wide-char measurement never splits a row. */
export const CommandPalette = ({
    commands,
    isOpen,
    onClose,
    placeholder = "Type to filter...",
    maxItems = 30,
}: CommandPaletteProps) => {
    const theme = useTheme();
    const [query, setQuery] = useState("");
    const [cursor, setCursor] = useState(0);

    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setCursor(0);
        }
    }, [isOpen]);

    const filtered = commands
        .filter((c) => fuzzyMatch(haystack(c), query))
        .toSorted((a, b) => fuzzyScore(haystack(a), query) - fuzzyScore(haystack(b), query))
        .slice(0, maxItems);

    const safeCursor = filtered.length === 0 ? 0 : Math.min(cursor, filtered.length - 1);

    useKeyboard((key) => {
        if (!isOpen) {
            return;
        }
        if (key.name === "escape") {
            key.preventDefault?.();
            key.stopPropagation?.();
            setQuery("");
            setCursor(0);
            onClose?.();
            return;
        }
        if (key.name === "up") {
            key.preventDefault?.();
            key.stopPropagation?.();
            setCursor((c) => Math.max(0, Math.min(c, Math.max(filtered.length - 1, 0)) - 1));
            return;
        }
        if (key.name === "down") {
            key.preventDefault?.();
            key.stopPropagation?.();
            setCursor((c) => Math.min(Math.max(c, 0) + 1, Math.max(filtered.length - 1, 0)));
            return;
        }
        if (key.name === "return" || key.name === "kpenter") {
            key.preventDefault?.();
            key.stopPropagation?.();
            const cmd = filtered[safeCursor];
            if (cmd) {
                cmd.onSelect?.();
                setQuery("");
                setCursor(0);
                onClose?.();
            }
            return;
        }
        if (key.name === "backspace" || key.name === "delete") {
            key.preventDefault?.();
            key.stopPropagation?.();
            setQuery((q) => q.slice(0, -1));
            setCursor(0);
            return;
        }
        if (key.name === "tab") {
            key.preventDefault?.();
            key.stopPropagation?.();
            return;
        }
        // Ignore control chords so e.g. ctrl+t never lands in the filter.
        if (key.ctrl || key.meta || key.super || key.hyper) {
            return;
        }
        // Printable input arrives as sequence ("a", "A", " ", ...).
        // key.name is "space" for spaces and lowercases letters, so prefer sequence.
        const seq = key.sequence ?? "";
        if (seq.length === 1) {
            const code = seq.charCodeAt(0);
            if (code >= 32 && code !== 127) {
                key.preventDefault?.();
                key.stopPropagation?.();
                setQuery((q) => q + seq);
                setCursor(0);
            }
        }
    });

    if (!isOpen) {
        return null;
    }

    const groups = new Map<string | undefined, typeof filtered>();
    for (const cmd of filtered) {
        const g = cmd.group;
        if (!groups.has(g)) {
            groups.set(g, []);
        }
        groups.get(g)?.push(cmd);
    }

    let flatIdx = -1;

    return (
        <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={10} backgroundColor="#0a0a0a">
            <box
                flexDirection="column"
                width="100%"
                height="100%"
                border
                borderStyle="rounded"
                borderColor={theme.colors.focusRing}
                paddingLeft={1}
                paddingRight={1}
            >
                <box border paddingLeft={1} paddingRight={1}>
                    <text fg={query ? theme.colors.foreground : theme.colors.mutedForeground}>
                        {query ? `Search: ${query}_` : placeholder}
                    </text>
                </box>

                {filtered.length === 0 ? (
                    <box paddingLeft={1} paddingRight={1}>
                        <text fg="#666">No matches</text>
                    </box>
                ) : (
                    <scrollbox flexGrow={1} stickyScroll={false} style={{ paddingLeft: 1, paddingRight: 1 }}>
                        <box flexDirection="column">
                            {[...groups.entries()].map(([group, cmds]) => (
                                <box key={group ?? "_"} flexDirection="column">
                                    {group && (
                                        <box paddingTop={1}>
                                            <text fg="#666">{`-- ${group} --`}</text>
                                        </box>
                                    )}
                                    {cmds.map((cmd) => {
                                        flatIdx += 1;
                                        const idx = flatIdx;
                                        const isCursor = idx === safeCursor;
                                        const marker = isCursor ? "> " : "  ";
                                        const shortcut = cmd.shortcut ? ` [${cmd.shortcut}]` : "";
                                        return (
                                            <box key={cmd.id} flexDirection="row">
                                                <text fg={isCursor ? "cyan" : theme.colors.foreground}>
                                                    {`${marker}${cmd.label}${cmd.description ? ` -- ${cmd.description}` : ""}${shortcut}`}
                                                </text>
                                            </box>
                                        );
                                    })}
                                </box>
                            ))}
                        </box>
                    </scrollbox>
                )}

                <text fg="#666">up/down: navigate | enter: run | esc: close</text>
            </box>
        </box>
    );
};
