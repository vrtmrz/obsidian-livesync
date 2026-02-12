import { type TFile } from "@/deps.ts";
import { eventHub } from "../../common/events.ts";
import { EVENT_REQUEST_SHOW_HISTORY } from "../../common/obsidianEvents.ts";
import type { FilePathWithPrefix, LoadedEntry, DocumentID } from "../../lib/src/common/types.ts";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { DocumentHistoryModal } from "./DocumentHistory/DocumentHistoryModal.ts";
import { fireAndForget } from "octagonal-wheels/promises";

export class ModuleObsidianDocumentHistory extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean> {
        this.addCommand({
            id: "livesync-history",
            name: "Show history",
            callback: () => {
                const file = this.services.vault.getActiveFilePath();
                if (file) this.showHistory(file, undefined);
            },
        });

        this.addCommand({
            id: "livesync-filehistory",
            name: "Pick a file to show history",
            callback: () => {
                fireAndForget(async () => await this.fileHistory());
            },
        });
        eventHub.onEvent(
            EVENT_REQUEST_SHOW_HISTORY,
            ({ file, fileOnDB }: { file: TFile | FilePathWithPrefix; fileOnDB: LoadedEntry }) => {
                this.showHistory(file, fileOnDB._id);
            }
        );
        return Promise.resolve(true);
    }

    showHistory(file: TFile | FilePathWithPrefix, id?: DocumentID) {
        new DocumentHistoryModal(this.app, this.plugin, file, id).open();
    }

    async fileHistory() {
        const notes: { id: DocumentID; path: FilePathWithPrefix; dispPath: string; mtime: number }[] = [];
        for await (const doc of this.localDatabase.findAllDocs()) {
            notes.push({ id: doc._id, path: this.getPath(doc), dispPath: this.getPath(doc), mtime: doc.mtime });
        }
        notes.sort((a, b) => b.mtime - a.mtime);
        const notesList = notes.map((e) => e.dispPath);
        const target = await this.core.confirm.askSelectString("File to view History", notesList);
        if (target) {
            const targetId = notes.find((e) => e.dispPath == target)!;
            this.showHistory(targetId.path, targetId.id);
        }
    }
    onBindFunction(core: typeof this.core, services: typeof core.services): void {
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
    }
}
