import type { DocumentID, EntryTypeNotes } from "@vrtmrz/livesync-commonlib/compat/common/types";

export interface JsonComparisonDocument {
    readonly _id: DocumentID;
    readonly _rev?: string;
    readonly mtime: number;
    readonly datatype: EntryTypeNotes;
    readonly data: string | string[];
}
