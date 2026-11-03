import type { TFile } from "@/deps";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { DocumentIdentity } from "@vrtmrz/livesync-commonlib/documents";

export const EVENT_REQUEST_SHOW_HISTORY = "show-history";

declare global {
    interface LSEvents {
        [EVENT_REQUEST_SHOW_HISTORY]:
            | { file: TFile; fileOnDB: DocumentIdentity }
            | { file: FilePathWithPrefix; fileOnDB: DocumentIdentity };
    }
}
