import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type";
import type { FSWatcher } from "chokidar";
import type { IDBPDatabase } from "idb";
import type { TFile } from "obsidian";
import type { TaggedType } from "octagonal-wheels/common/types";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";

declare const localTypeTag: unique symbol;

type LocalObject = {
    readonly value: string;
};

type LocalTaggedType = string & {
    readonly [localTypeTag]: "LocalTaggedType";
};

export type LocalObjectUnionProbe = LocalObject | undefined;
export type LocalTaggedUnionProbe = LocalTaggedType | undefined;
export type OctagonalWheelsTaggedUnionProbe = TaggedType<string, "ExternalTaggedType"> | undefined;
export type CommonlibFilePathUnionProbe = FilePath | undefined;
export type CommonlibSettingsUnionProbe = ObsidianLiveSyncSettings | undefined;
export type OctagonalWheelsStoreUnionProbe = SimpleStore<unknown> | undefined;
export type IndexedDBUnionProbe = IDBPDatabase<unknown> | undefined;
export type ObsidianFileUnionProbe = TFile | undefined;
export type ChokidarWatcherUnionProbe = FSWatcher | undefined;
