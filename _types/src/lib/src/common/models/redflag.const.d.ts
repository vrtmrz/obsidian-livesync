// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath } from "./db.type";
export declare const PREFIXMD_LOGFILE = "livesync_log_";
export declare const PREFIXMD_LOGFILE_UC = "LIVESYNC_LOG_";
export declare const FlagFilesOriginal: {
    readonly SUSPEND_ALL: FilePath;
    readonly REBUILD_ALL: FilePath;
    readonly FETCH_ALL: FilePath;
};
export declare const FlagFilesHumanReadable: {
    readonly REBUILD_ALL: FilePath;
    readonly FETCH_ALL: FilePath;
};
/**
 * @deprecated Use `FlagFilesOriginal.SUSPEND_ALL` instead.
 */
export declare const FLAGMD_REDFLAG: FilePath;
/**
 * @deprecated Use `FlagFilesHumanReadable.REBUILD_ALL` instead.
 */
export declare const FLAGMD_REDFLAG2: FilePath;
/**
 * @deprecated Use `FlagFilesHumanReadable.FETCH_ALL` instead.
 */
export declare const FLAGMD_REDFLAG2_HR: FilePath;
/**
 * @deprecated Use `FlagFilesOriginal.FETCH_ALL` instead.
 */
export declare const FLAGMD_REDFLAG3: FilePath;
/**
 * @deprecated Use `FlagFilesHumanReadable.FETCH_ALL` instead.
 */
export declare const FLAGMD_REDFLAG3_HR: FilePath;
