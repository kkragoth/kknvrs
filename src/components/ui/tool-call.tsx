/* @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from "react";

import { useTheme } from "@/hooks/use-theme";
import { oneLine, splitOutputLines } from "@/lib/text.js";

export type ToolCallStatus = "pending" | "running" | "success" | "error";

export interface ToolCallProps {
    name: string;
    args?: Record<string, unknown>;
    status: ToolCallStatus;
    result?: unknown;
    duration?: number;
    collapsible?: boolean;
    /** Controlled collapse. When omitted the row starts expanded while
     * running and collapses on completion. */
    collapsed?: boolean;
    onToggle?: () => void;
}

export const ToolCall = ({
    name,
    args,
    status,
    result,
    duration,
    collapsible = true,
    collapsed: collapsedProp,
    onToggle,
}: ToolCallProps) => {
    const theme = useTheme();
    const [autoCollapsed, setAutoCollapsed] = useState(status !== "running");
    const [elapsed, setElapsed] = useState(0);
    const startRef = useRef(Date.now());
    const [frame, setFrame] = useState(0);

    // Collapse is controlled by the parent when provided (one global toggle
    // must not flip every row); otherwise follow the run lifecycle locally.
    const collapsed = collapsedProp ?? autoCollapsed;

    useEffect(() => {
        if (onToggle) return;
        setAutoCollapsed(status !== "running");
    }, [status, onToggle]);

    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const spinnerIcon = spinnerFrames[frame % spinnerFrames.length] ?? "⠋";
    useEffect(() => {
        if (status !== "running") return;
        const id = setInterval(() => setFrame((f) => f + 1), Math.round(1000 / 12));
        return () => clearInterval(id);
    }, [status]);

    useEffect(() => {
        if (status !== "running") {
            return;
        }
        startRef.current = Date.now();
        const id = setInterval(() => {
            setElapsed(Date.now() - startRef.current);
        }, 100);
        return () => clearInterval(id);
    }, [status]);

    const statusIcon = () => {
        switch (status) {
            case "pending": {
                return <text fg="#666">○</text>;
            }
            case "running": {
                return <text fg={theme.colors.primary}>{spinnerIcon}</text>;
            }
            case "success": {
                return <text fg={theme.colors.success ?? "green"}>✓</text>;
            }
            case "error": {
                return <text fg={theme.colors.error ?? "red"}>✗</text>;
            }
            default: {
                break;
            }
        }
    };

    let durationText: string | null;
    if (duration === undefined) {
        durationText = status === "running" ? `${elapsed}ms` : null;
    } else {
        durationText = `${duration}ms`;
    }

    let nameColor: string;
    if (status === "error") {
        nameColor = theme.colors.error ?? "red";
    } else if (status === "success") {
        nameColor = theme.colors.success ?? "green";
    } else if (status === "running") {
        nameColor = theme.colors.primary;
    } else {
        nameColor = theme.colors.mutedForeground;
    }

    const selection = {
        selectionBg: theme.colors.selection,
        selectionFg: theme.colors.selectionForeground,
    };

    return (
        <box flexDirection="column">
            <box flexDirection="row" gap={1}>
                {statusIcon()}
                <text fg={nameColor} selectable {...selection}>
                    {status !== "pending" ? <b>{name}</b> : name}
                </text>
                {durationText && <text fg={theme.colors.mutedForeground}>{`(${durationText})`}</text>}
                {collapsible && <text fg="#666">{collapsed ? "▶" : "▼"}</text>}
            </box>

            {collapsed || (
                <box flexDirection="column" paddingLeft={2}>
                    {args && Object.keys(args).length > 0 && (
                        <box flexDirection="column">
                            <text fg="#666">Args:</text>
                            {...Object.entries(args).map(([k, v]) => (
                                <box key={k} flexDirection="row" gap={1}>
                                    <text fg={theme.colors.accent}>{`${k}:`}</text>
                                    <text fg="#666" selectable {...selection}>
                                        {oneLine(JSON.stringify(v), 80)}
                                    </text>
                                </box>
                            ))}
                        </box>
                    )}
                    {result !== undefined && (
                        <box flexDirection="column">
                            <text fg="#666">Result:</text>
                            {splitOutputLines(
                                typeof result === "string" ? result : JSON.stringify(result, null, 2),
                            ).map((line, i) => (
                                <text key={i} fg="#666" selectable {...selection}>
                                    {line}
                                </text>
                            ))}
                        </box>
                    )}
                </box>
            )}
        </box>
    );
};
