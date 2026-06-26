import { type TFile } from "@/deps.ts";
import type { FilePathWithPrefix, DocumentID } from "@lib/common/types.ts";
import { DocumentHistoryModal } from "@/modules/features/DocumentHistory/DocumentHistoryModal.ts";
import type { DocumentHistoryHost } from "./types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";

/**
 * Opens the document history modal dialogue for a given file.
 *
 * @param host - The service feature host context.
 * @param file - The file path or TFile reference to query history.
 * @param id - Optional CouchDB document identifier.
 */
export function showHistory(host: DocumentHistoryHost, file: TFile | FilePathWithPrefix, id?: DocumentID): void {
    const app = (host as any).app;
    const plugin = (host as any).plugin;
    new DocumentHistoryModal(app, host as any, plugin, file, id).open();
}

/**
 * Displays a list of all local documents, prompting the user to select one to view its history.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 */
export async function fileHistory(host: DocumentHistoryHost, log: LogFunction): Promise<void> {
    const notes: { id: DocumentID; path: FilePathWithPrefix; dispPath: string; mtime: number }[] = [];
    const localDatabase = host.services.database.localDatabase;

    for await (const doc of localDatabase.findAllDocs()) {
        const path = host.services.path.getPath(doc);
        notes.push({ id: doc._id, path, dispPath: path, mtime: doc.mtime });
    }
    notes.sort((a, b) => b.mtime - a.mtime);
    const notesList = notes.map((e) => e.dispPath);
    const confirm = host.services.UI.confirm;
    const target = await confirm.askSelectString("File to view History", notesList);
    if (target) {
        const targetId = notes.find((e) => e.dispPath === target)!;
        showHistory(host, targetId.path, targetId.id);
    }
}
