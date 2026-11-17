/** Convert a duration in seconds to the millisecond unit accepted by timers. */
export function secondsToMilliseconds(seconds: number): number {
    return seconds * 1000;
}
