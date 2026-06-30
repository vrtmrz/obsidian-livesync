// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { TFile, Modal, App } from "@/deps.ts";
import ObsidianLiveSyncPlugin from "@/main.ts";
import { type DocumentID, type FilePathWithPrefix, type LoadedEntry } from "@lib/common/types.ts";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore.ts";
export declare class DocumentHistoryModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    core: LiveSyncBaseCore;
    get services(): import("../../../lib/src/services/InjectableServices").InjectableServiceHub<import("../../../lib/src/services/base/ServiceBase").ServiceContext>;
    range: HTMLInputElement;
    contentView: HTMLDivElement;
    info: HTMLDivElement;
    fileInfo: HTMLDivElement;
    showDiff: boolean;
    diffOnly: boolean;
    id?: DocumentID;
    file: FilePathWithPrefix;
    revs_info: PouchDB.Core.RevisionInfo[];
    currentDoc?: LoadedEntry;
    currentText: string;
    currentDeleted: boolean;
    initialRev?: string;
    currentDiffIndex: number;
    diffNavContainer: HTMLDivElement;
    diffNavIndicator: HTMLSpanElement;
    diffOnlyLabel: HTMLLabelElement;
    searchKeyword: string;
    searchResults: {
        rev: string;
        index: number;
        matchType: "Content" | "Diff";
    }[];
    currentSearchIndex: number;
    searchResultIndicator: HTMLSpanElement;
    searchProgressIndicator: HTMLSpanElement;
    searchTimeout: number | null;
    constructor(app: App, core: LiveSyncBaseCore, plugin: ObsidianLiveSyncPlugin, file: TFile | FilePathWithPrefix, id?: DocumentID, revision?: string);
    loadFile(initialRev?: string): Promise<void>;
    loadRevs(initialRev?: string): Promise<void>;
    BlobURLs: Map<string, string>;
    revokeURL(key: string): void;
    generateBlobURL(key: string, data: Uint8Array): string;
    prepareContentView(usePreformatted?: boolean): void;
    appendTextDiff(diff: [number, string][]): void;
    appendSearchHighlightedText(container: HTMLElement, text: string): void;
    appendImageDiff(baseSrc: string, overlaySrc?: string): void;
    appendDeletedNotice(usePreformatted?: boolean): void;
    showExactRev(rev: string): Promise<void>;
    /**
     * Navigate to the previous or next diff block in the content view.
     * Only effective when diff highlighting is enabled.
     */
    navigateDiff(direction: "prev" | "next"): void;
    /**
     * Reset the diff navigation index and update the indicator.
     */
    resetDiffNavigation(): void;
    /**
     * Show or hide the diff navigation buttons based on the showDiff state.
     */
    updateDiffNavVisibility(): void;
    /**
     * Search through the last 100 revisions for the given keyword.
     */
    performSearch(keyword: string): Promise<void>;
    updateSearchUI(): void;
    navigateSearch(direction: "prev" | "next"): void;
    onOpen(): void;
    onClose(): void;
}
