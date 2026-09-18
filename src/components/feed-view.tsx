/* Chat transcript rows composed from termcn OpenTUI components:
 * ChatMessage (user / assistant / system bubbles), StreamingText
 * (assistant answer), ThinkingBlock (per-turn tool summary) and
 * ToolCall (one row per tool invocation). */
import { useTheme } from "@/hooks/use-theme.js";
import type { FeedItem, ToolStep, Turn } from "@/types.js";
import { isWorkingTurn, turnPhaseLabel } from "@/lib/turn.js";
import { formatUsageLong, hasUsage } from "@/lib/tokens.js";
import { thinkingContent } from "@/lib/text.js";
import { useChatStore } from "@/stores/chat-store.js";
import { ChatMessage } from "@/components/ui/chat-message.js";
import { StreamingText } from "@/components/ui/streaming-text.js";
import { ThinkingBlock } from "@/components/ui/thinking-block.js";
import { ToolCall } from "@/components/ui/tool-call.js";
import type { ToolCallStatus } from "@/components/ui/tool-call.js";

function stepStatus(step: ToolStep, working: boolean): ToolCallStatus {
    if (step.output !== undefined) return "success";
    return working ? "running" : "pending";
}

export function TurnView({ turn, now }: { turn: Turn; now: number }) {
    const theme = useTheme();
    const working = isWorkingTurn(turn);
    const showTools = turn.expanded;
    const duration = (turn.endedAt ?? now) - turn.startedAt;
    const label = turnPhaseLabel(turn);
    const baseContent = thinkingContent(turn, working);
    const content =
        turn.expanded && hasUsage(turn.tokens) ? `${baseContent}\n${formatUsageLong(turn.tokens)}` : baseContent;
    const selection = {
        selectionBg: theme.colors.selection,
        selectionFg: theme.colors.selectionForeground,
    };

    return (
        <box flexDirection="column">
            <ChatMessage sender="user" name="You" selectable>
                {turn.userText}
            </ChatMessage>

            <ThinkingBlock
                streaming={working}
                collapsed={!turn.expanded}
                label={label}
                tokens={turn.tokens}
                duration={duration}
                content={content}
                onToggle={() => useChatStore.getState().toggleTurnExpanded(turn.id)}
            />

            {showTools &&
                turn.tools.map((t: ToolStep, i: number) => (
                    <box key={i} style={{ paddingLeft: 1 }}>
                        <ToolCall
                            name={t.tool}
                            args={t.args}
                            status={stepStatus(t, working)}
                            result={t.output}
                            duration={t.elapsedMs}
                            collapsible={false}
                        />
                    </box>
                ))}

            <ChatMessage sender="assistant" name="Assistant" streaming={working} selectable>
                <>
                    {turn.clarification && (
                        <box flexDirection="column">
                            <text fg="#eab308" selectable {...selection}>
                                ❓ {turn.clarification.question}
                            </text>
                            {turn.clarification.options.map((o, i) => (
                                <text key={i} fg="#666" selectable {...selection}>
                                    {"  "}
                                    {i + 1}. {o}
                                </text>
                            ))}
                            <text fg="#666" selectable {...selection}>
                                {"  "}↳{" "}
                                {turn.clarification.options.length > 0
                                    ? "Reply with the number, or type your own answer."
                                    : "Type your answer below."}
                            </text>
                        </box>
                    )}
                    <StreamingText text={turn.answer} selectable cursor={false} />
                    {working && <text fg="#666">▍</text>}
                </>
            </ChatMessage>
        </box>
    );
}

export function FeedView({ item, now }: { item: FeedItem; now: number }) {
    if (item.kind === "turn") {
        return <TurnView turn={item.turn} now={now} />;
    }
    if (item.kind === "queued") {
        return (
            <ChatMessage sender="user" name="You (queued)" selectable>
                {item.text}
            </ChatMessage>
        );
    }
    return (
        <ChatMessage sender="system" selectable>
            {item.text}
        </ChatMessage>
    );
}
