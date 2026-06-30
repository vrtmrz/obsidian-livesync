// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { AUTO_MERGED, CANCELLED, MISSING_OR_ERROR, NOT_CONFLICTED } from "./shared.const.symbols";
export type diff_result_leaf = {
    rev: string;
    data: string;
    ctime: number;
    mtime: number;
    deleted?: boolean;
};
export type dmp_result = Array<[number, string]>;
export type diff_result = {
    left: diff_result_leaf;
    right: diff_result_leaf;
    diff: dmp_result;
};
export type DIFF_CHECK_RESULT_AUTO = typeof CANCELLED | typeof AUTO_MERGED | typeof NOT_CONFLICTED | typeof MISSING_OR_ERROR;
export type diff_check_result = DIFF_CHECK_RESULT_AUTO | diff_result;
