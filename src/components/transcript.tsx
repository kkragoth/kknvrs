import { useEffect, useState } from "react";
import { FeedView } from "@/components/feed-view.js";
import { useChatStore } from "@/stores/chat-store.js";

/** Scrollable transcript. Owns the tick that drives live turn durations. */
export function Transcript() {
    const feed = useChatStore((s) => s.feed);
    const busy = useChatStore((s) => s.busy);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!busy) return;
        const t = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(t);
    }, [busy]);

    return (
        <box flexDirection="column">
            {feed.map((item) =>
                item.kind === "turn" ? (
                    <FeedView key={item.turn.id} item={item} now={now} />
                ) : (
                    <FeedView key={item.id} item={item} now={now} />
                ),
            )}
        </box>
    );
}
