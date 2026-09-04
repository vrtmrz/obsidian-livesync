import type { PluginManifest } from "@/deps.ts";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isObjectDifferent } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { writable } from "svelte/store";

import { PluginDataExDisplayV2 } from "./customisationSyncModel.ts";
import type { IPluginDataExDisplay } from "./customisationSyncView.ts";

/**
 * Owns the transient catalogue projection used by Customisation Sync.
 *
 * The database and storage operations remain in the context. This owner only
 * coordinates the in-memory rows, their reactive publications, manifest
 * lookup, and the update counter which is derived from those operations.
 */
export class CustomisationSyncCatalogueState {
    private catalogueRows: IPluginDataExDisplay[] = [];
    private readonly manifestByKey = new Map<string, PluginManifest>();
    private readonly loadedManifestMTimeByKey = new Map<string, number>();
    private activeUpdateCount = 0;

    readonly catalogue = writable<IPluginDataExDisplay[]>([]);
    readonly migrationProgress = writable(0);
    readonly manifests = writable(this.manifestByKey);

    /** The current manifest lookup passed to V2 display rows. */
    get manifestLookup(): ReadonlyMap<string, PluginManifest> {
        return this.manifestByKey;
    }

    /** The current loaded-manifest cache, exposed read-only for diagnostics. */
    get loadedManifestMTime(): ReadonlyMap<string, number> {
        return this.loadedManifestMTimeByKey;
    }

    /** Returns the authoritative row for a V1 document path, when present. */
    findPlugin(documentPath: FilePathWithPrefix | string): IPluginDataExDisplay | undefined {
        return this.catalogueRows.find((entry) => entry.documentPath == documentPath);
    }

    /** Returns every row matching a document path, preserving legacy duplicates. */
    findPlugins(documentPath: FilePathWithPrefix | string): readonly IPluginDataExDisplay[] {
        return this.catalogueRows.filter((entry) => entry.documentPath == documentPath);
    }

    /** Replaces a V1 row and publishes it immediately, preserving legacy order. */
    replacePlugin(plugin: IPluginDataExDisplay): void {
        const newList = this.catalogueRows.filter((entry) => entry.documentPath != plugin.documentPath);
        newList.push(plugin);
        this.catalogueRows = newList;
        this.catalogue.set(newList);
    }

    /**
     * Replaces a V2 row without publishing it. V2 callers publish through the
     * existing delayed task after a cohesive row update has completed.
     */
    private replaceV2Plugin(plugin: PluginDataExDisplayV2): void {
        const newList = this.catalogueRows.filter((entry) => entry.documentPath != plugin.documentPath);
        newList.push(plugin);
        this.catalogueRows = newList;
    }

    /** Applies one loaded or removed V2 file and replaces its catalogue row. */
    async updateV2Plugin(
        plugin: PluginDataExDisplayV2,
        file: Parameters<PluginDataExDisplayV2["setFile"]>[0] | false,
        missingFilePath: string
    ): Promise<void> {
        if (file) {
            await plugin.setFile(file);
        } else {
            plugin.deleteFile(missingFilePath);
        }
        this.replaceV2Plugin(plugin);
    }

    /** Publishes the current V2 row set when the legacy delayed task fires. */
    publishCatalogue(): void {
        this.catalogue.set(this.catalogueRows);
    }

    /**
     * Clears rows and loaded manifest mtimes for an explicit reload. The
     * manifest map intentionally survives this narrower refresh.
     */
    clearForReload(): void {
        this.catalogueRows = [];
        this.loadedManifestMTimeByKey.clear();
        this.catalogue.set(this.catalogueRows);
    }

    /** Clears only the catalogue rows for a disabled refresh. */
    clearForDisabledRefresh(): void {
        this.catalogueRows = [];
        this.catalogue.set(this.catalogueRows);
    }

    /** Begins one catalogue update and publishes its progress count. */
    beginUpdate(): void {
        this.activeUpdateCount++;
        this.migrationProgress.set(this.activeUpdateCount);
    }

    /** Ends one catalogue update and publishes its progress count. */
    endUpdate(): void {
        this.activeUpdateCount--;
        this.migrationProgress.set(this.activeUpdateCount);
    }

    /**
     * Applies a manifest according to the inherited cache rules. A manifest is
     * parsed only when no manifest has previously been accepted for the key;
     * failed parses still record their mtime, while a later mtime never
     * replaces a successfully parsed first manifest.
     */
    processManifest(
        confKey: string,
        mtime: number,
        parseManifest: () => PluginManifest,
        onParseError: (error: unknown) => void = () => undefined
    ): void {
        let publishCatalogue = false;
        if (this.loadedManifestMTimeByKey.get(confKey) != mtime && this.manifestByKey.get(confKey) == undefined) {
            try {
                this.setManifest(confKey, parseManifest());
                this.applyLoadedManifest(confKey);
                publishCatalogue = true;
            } catch (error) {
                onParseError(error);
            }
            this.loadedManifestMTimeByKey.set(confKey, mtime);
        } else {
            this.applyLoadedManifest(confKey);
            publishCatalogue = true;
        }
        if (publishCatalogue) this.catalogue.set(this.catalogueRows);
    }

    private setManifest(key: string, manifest: PluginManifest): void {
        const old = this.manifestByKey.get(key);
        if (old && !isObjectDifferent(manifest, old)) return;
        this.manifestByKey.set(key, manifest);
        this.manifests.set(this.manifestByKey);
    }

    private applyLoadedManifest(confKey: string): void {
        this.catalogueRows
            .filter((entry) => entry instanceof PluginDataExDisplayV2 && entry.confKey == confKey)
            .forEach((entry) => (entry as PluginDataExDisplayV2).applyLoadedManifest());
    }
}
