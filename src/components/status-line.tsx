import { Spinner } from "@/components/ui/spinner.js";
import { useChatStore } from "@/stores/chat-store.js";

/** Status line: copy flash wins, then working spinner, then idle status. */
export function StatusLine() {
    const busy = useChatStore((s) => s.busy);
    const status = useChatStore((s) => s.status);
    const queue = useChatStore((s) => s.queue);
    const flash = useChatStore((s) => s.flash);

    const label = flash
        ? flash
        : busy
          ? `Working…${queue.length > 0 ? ` · Queued (${queue.length})` : ""} (esc cancels)`
          : status;

    if (busy) {
        return <Spinner type="dots" label={label} />;
    }
    return <text fg="gray">{label}</text>;
}
