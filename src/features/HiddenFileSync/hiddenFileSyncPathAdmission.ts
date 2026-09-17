import type { CustomRegExpSourceList, FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { CustomRegExp } from "@vrtmrz/livesync-commonlib/compat/common/utils";

import {
    isHiddenFileSyncPath,
    matchesHiddenFileSyncPatterns,
    type HiddenFileSyncPathFilters,
} from "./hiddenFileSyncPathPolicy.ts";

type HiddenFileSyncPathRegExpKey = "syncInternalFilesIgnorePatterns" | "syncInternalFilesTargetPatterns";

export type HiddenFileSyncPathAdmissionDependencies = {
    getTargetPatternSource(): CustomRegExpSourceList<",">;
    getIgnorePatternSource(): CustomRegExpSourceList<",">;
    getFileRegExp(key: HiddenFileSyncPathRegExpKey): readonly CustomRegExp[];
    isIgnoredByIgnoreFile(path: FilePath): Promise<boolean>;
    ownsLocalFile(path: FilePath): boolean;
};

export type HiddenFileSyncPathAdmission = {
    isTargetFileEligible(path: FilePath): Promise<boolean>;
    isTargetFile(path: FilePath): Promise<boolean>;
    invalidatePatternCache(): void;
    dispose(): void;
};

class HiddenFileSyncPathAdmissionOwner implements HiddenFileSyncPathAdmission {
    private readonly cacheFileRegExps = new Map<string, HiddenFileSyncPathFilters>();

    constructor(private readonly dependencies: HiddenFileSyncPathAdmissionDependencies) {}

    private parseRegExpSettings(): HiddenFileSyncPathFilters {
        const targetPatternSource = this.dependencies.getTargetPatternSource();
        const ignorePatternSource = this.dependencies.getIgnorePatternSource();
        const regExpKey = `${targetPatternSource}||${ignorePatternSource}`;
        const cached = this.cacheFileRegExps.get(regExpKey);
        if (cached) return cached;

        // Keep the inherited parser order: ignore patterns are read before target patterns.
        const ignoreFilter = this.dependencies.getFileRegExp("syncInternalFilesIgnorePatterns");
        const targetFilter = this.dependencies.getFileRegExp("syncInternalFilesTargetPatterns");
        const filters: HiddenFileSyncPathFilters = { ignoreFilter, targetFilter };
        this.cacheFileRegExps.clear();
        this.cacheFileRegExps.set(regExpKey, filters);
        return filters;
    }

    async isTargetFileEligible(path: FilePath): Promise<boolean> {
        const result = matchesHiddenFileSyncPatterns(path, this.parseRegExpSettings()) && isHiddenFileSyncPath(path);
        if (!result) return false;
        return !(await this.dependencies.isIgnoredByIgnoreFile(path));
    }

    async isTargetFile(path: FilePath): Promise<boolean> {
        // Ownership is checked first so another optional-file owner cannot be filtered by this feature.
        if (this.dependencies.ownsLocalFile(path) === false) return false;
        return await this.isTargetFileEligible(path);
    }

    invalidatePatternCache(): void {
        this.cacheFileRegExps.clear();
    }

    dispose(): void {
        this.cacheFileRegExps.clear();
    }
}

export function createHiddenFileSyncPathAdmission(
    dependencies: HiddenFileSyncPathAdmissionDependencies
): HiddenFileSyncPathAdmission {
    return new HiddenFileSyncPathAdmissionOwner(dependencies);
}
