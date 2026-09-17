import type { PluginManifest } from "@/deps.ts";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isDocContentSame } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { getCustomisationSyncCategoryFolder } from "./customisationSyncPaths.ts";
import type { IPluginDataExDisplay, LoadedEntryPluginDataExFile } from "./customisationSyncView.ts";

export class PluginDataExDisplayV2 {
    documentPath: FilePathWithPrefix;
    category: string;
    term: string;
    files: LoadedEntryPluginDataExFile[];
    name: string;
    confKey: string;
    _displayName: string | undefined;
    _version: string | undefined;

    constructor(
        data: IPluginDataExDisplay,
        private readonly manifestLookup: ReadonlyMap<string, PluginManifest>
    ) {
        this.documentPath = `${data.documentPath}` as FilePathWithPrefix;
        this.category = `${data.category}`;
        this.name = `${data.name}`;
        this.term = `${data.term}`;
        this.files = [...(data.files as LoadedEntryPluginDataExFile[])];
        this.confKey = `${getCustomisationSyncCategoryFolder(this.category, this.term)}${this.name}`;
        this.applyLoadedManifest();
    }

    async setFile(file: LoadedEntryPluginDataExFile): Promise<void> {
        const old = this.files.find((entry) => entry.filename == file.filename);
        if (old) {
            if (old.mtime == file.mtime && (await isDocContentSame(old.data, file.data))) return;
            this.files = this.files.filter((entry) => entry.filename != file.filename);
        }
        this.files.push(file);
        if (file.filename == "manifest.json") {
            this.applyLoadedManifest();
        }
    }

    deleteFile(filename: string): void {
        this.files = this.files.filter((entry) => entry.filename != filename);
    }

    applyLoadedManifest(): void {
        const manifest = this.manifestLookup.get(this.confKey);
        if (manifest) {
            this._displayName = manifest.name;
            if (this.category == "PLUGIN_MAIN" || this.category == "THEME") {
                this._version = manifest.version;
            }
        }
    }

    get displayName(): string {
        return this._displayName || this.name;
    }

    get version(): string | undefined {
        return this._version;
    }

    get mtime(): number {
        return ~~this.files.reduce((sum, file) => sum + file.mtime, 0) / this.files.length;
    }
}
