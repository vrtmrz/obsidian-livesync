import type { CustomRegExp } from "@vrtmrz/livesync-commonlib/compat/common/utils";

export type HiddenFileSyncPathFilters = {
    ignoreFilter: readonly CustomRegExp[];
    targetFilter: readonly CustomRegExp[];
};

export function isHiddenFileSyncPath(path: string): boolean {
    // Compatibility: this prefix check also excludes names such as `.trashcan`.
    // Keep the broader exclusion until a separate path-policy decision changes it.
    return path.startsWith(".") && !path.startsWith(".trash");
}

export function matchesHiddenFileSyncPatterns(path: string, filters: HiddenFileSyncPathFilters): boolean {
    if (filters.ignoreFilter.some((pattern) => pattern.test(path))) {
        return false;
    }
    if (filters.targetFilter.length > 0) {
        return filters.targetFilter.some((pattern) => pattern.test(path));
    }
    return true;
}
