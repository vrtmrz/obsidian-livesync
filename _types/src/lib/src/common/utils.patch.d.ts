// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
export declare function generatePatchObj(from: Record<string | number | symbol, unknown>, to: Record<string | number | symbol, unknown>): Record<string | number | symbol, unknown>;
export declare function applyPatch(from: Record<string | number | symbol, unknown>, patch: Record<string | number | symbol, unknown>): Record<string | number | symbol, unknown>;
export declare function mergeObject(objA: Record<string | number | symbol, unknown> | [unknown], objB: Record<string | number | symbol, unknown> | [unknown]): unknown[] | {
    [k: string]: unknown;
};
export declare function flattenObject(obj: Record<string | number | symbol, unknown>, path?: string[]): [string, unknown][];
export declare function isSensibleMargeApplicable(path: string): boolean;
export declare function isObjectMargeApplicable(path: string): boolean;
