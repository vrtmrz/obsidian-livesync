import type { TFile } from "../deps";
import type { FilePathWithPrefix, LoadedEntry } from "../lib/src/common/types";

export const EVENT_REQUEST_SHOW_HISTORY = "show-history";

declare global {
    interface LSEvents {
        [EVENT_REQUEST_SHOW_HISTORY]: { file: TFile, fileOnDB: LoadedEntry } | { file: FilePathWithPrefix, fileOnDB: LoadedEntry };
    }
}
