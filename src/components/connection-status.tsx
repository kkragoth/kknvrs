import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner.js";
import { connectionColor, connectionLabel, isConnecting, isDisconnected } from "@/lib/connection.js";
import { useSessionStore } from "@/stores/session-store.js";

/** Connection badge: CONNECTING (spinner) / CONNECTED (green) / NO CONNECTION (red).
 * Self-polls GET /health every 5s while disconnected so recovery is automatic. */
export function ConnectionStatusBadge() {
    const status = useSessionStore((s) => s.connection);
    const label = connectionLabel(status);
    const color = connectionColor(status);

    useEffect(() => {
        if (!isDisconnected(status)) return;
        const timer = setInterval(() => {
            void useSessionStore.getState().checkConnection();
        }, 5000);
        return () => clearInterval(timer);
    }, [status]);

    if (isConnecting(status)) {
        return <Spinner type="dots" label="CONNECTING…" color="yellow" />;
    }
    return <text fg={color}>● {label}</text>;
}
