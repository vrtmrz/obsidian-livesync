/** Returns whether the status UI should report HTTP traffic or a finite remote operation in progress. */
export function hasRemoteActivity(requestCount: number, responseCount: number, boundedRemoteActivityCount: number) {
    return requestCount - responseCount !== 0 || boundedRemoteActivityCount !== 0;
}
