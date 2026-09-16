import { useSessionStore } from "@/stores/session-store.js";
import { ConnectionStatusBadge } from "@/components/connection-status.js";

/** Top title bar: agent · provider:model · thread · connection state. */
export function HeaderBar() {
    const agentName = useSessionStore((s) => s.agentName);
    const provider = useSessionStore((s) => s.provider);
    const model = useSessionStore((s) => s.model);
    const threadId = useSessionStore((s) => s.threadId);

    return (
        <box
            border
            borderStyle="single"
            flexDirection="row"
            justifyContent="space-between"
            style={{ paddingLeft: 1, paddingRight: 1 }}
        >
            <text>
                <strong fg="cyan">kknvrs</strong>
                <span fg="gray">
                    {" "}
                    · {agentName || "no-agent"} · {provider}:{model} · thread {threadId ? threadId.slice(-6) : "…"}
                </span>
            </text>
            <ConnectionStatusBadge />
        </box>
    );
}
