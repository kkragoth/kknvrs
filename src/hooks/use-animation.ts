import { useEffect, useState } from "react";

export type AnimationOptions = number | { intervalMs?: number; fps?: number };

/** Minimal OpenTUI frame counter backing the termcn Spinner.
 * Accepts frames-per-second or an explicit interval in milliseconds,
 * returns the current frame index. */
export function useAnimation(options: AnimationOptions): number {
    const intervalMs =
        typeof options === "number"
            ? Math.max(1, Math.round(1000 / options))
            : (options.intervalMs ?? (options.fps ? Math.max(1, Math.round(1000 / options.fps)) : 80));
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setFrame((f) => f + 1), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return frame;
}
