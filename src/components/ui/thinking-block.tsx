/* @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from "react";
import { MouseButton, type MouseEvent } from "@opentui/core";
import { useTheme } from "@/hooks/use-theme";
import type { TokenUsage } from "@/types.js";
import { formatUsageShort, hasUsage } from "@/lib/tokens.js";

export interface ThinkingBlockProps {
    content: string;
    streaming?: boolean;
    /** Controlled collapse — the parent owns the toggle so one keypress
     * flips exactly one block. Defaults to collapsed when finished. */
    collapsed?: boolean;
    label?: string;
    /** Per-turn model usage; header shows compact "↑1.2k ↓800". */
    tokens?: TokenUsage;
    duration?: number;
    /** Click handler for the header line. When set, a left-click (press and
     * release on the same cell, so drag-to-copy is unaffected) calls it. */
    onToggle?: () => void;
}

export const ThinkingBlock = ({
    content,
    streaming = false,
    collapsed: collapsedProp,
    label = "Reasoning",
    tokens,
    duration,
    onToggle,
}: ThinkingBlockProps) => {
    const theme = useTheme();
    const collapsed = collapsedProp ?? (!streaming && true);
    const [frame, setFrame] = useState(0);
    // Press position: only a release on the same cell counts as a click,
    // so starting a drag-selection on the header never toggles the block.
    const downPos = useRef<{ x: number; y: number } | null>(null);

    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    useEffect(() => {
        if (!streaming) return;
        const id = setInterval(() => setFrame((f) => f + 1), Math.round(1000 / 12));
        return () => clearInterval(id);
    }, [streaming]);

    const tokenStr = tokens && hasUsage(tokens) ? formatUsageShort(tokens) : null;
    const durationStr = duration === undefined ? null : `${(duration / 1000).toFixed(1)}s`;

    const headerParts = [streaming ? "Thinking..." : label, tokenStr, durationStr].filter(Boolean);

    const headerText = headerParts.join(" · ");
    const orange = theme.colors.warning ?? "#F59E0B";
    const lines = content.split("\n");

    return (
        <box flexDirection="column">
            <box
                flexDirection="row"
                gap={1}
                onMouseDown={
                    onToggle
                        ? (e: MouseEvent) => {
                              if (e.button === MouseButton.LEFT) downPos.current = { x: e.x, y: e.y };
                          }
                        : undefined
                }
                onMouseUp={
                    onToggle
                        ? (e: MouseEvent) => {
                              const down = downPos.current;
                              downPos.current = null;
                              if (e.button !== MouseButton.LEFT || !down || down.x !== e.x || down.y !== e.y) return;
                              onToggle();
                          }
                        : undefined
                }
            >
                <text fg={orange}>{collapsed ? "▶" : "▼"}</text>
                {streaming && <text fg={orange}>{spinnerFrames[frame % spinnerFrames.length]}</text>}
                <text fg={orange}>{headerText}</text>
            </box>

            {collapsed || (
                <box flexDirection="column">
                    {lines.map((line, i) => (
                        <text
                            key={i}
                            fg={theme.colors.mutedForeground}
                            selectable
                            selectionBg={theme.colors.selection}
                            selectionFg={theme.colors.selectionForeground}
                        >
                            {line}
                        </text>
                    ))}
                </box>
            )}
        </box>
    );
};
