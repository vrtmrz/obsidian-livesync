// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { TFile } from "@/deps";
import type { FilePathWithPrefix, LoadedEntry } from "@lib/common/types";
export declare const EVENT_REQUEST_SHOW_HISTORY = "show-history";
declare global {
    interface LSEvents {
        [EVENT_REQUEST_SHOW_HISTORY]: {
            file: TFile;
            fileOnDB: LoadedEntry;
        } | {
            file: FilePathWithPrefix;
            fileOnDB: LoadedEntry;
        };
    }
}
