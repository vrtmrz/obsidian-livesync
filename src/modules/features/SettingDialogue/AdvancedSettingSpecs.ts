import { ChunkAlgorithmNames } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { SettingSpecGroup } from "./SettingSpec.ts";

export type AdvancedSettingSpecContext = {
    isCouchDB: () => boolean;
};

/** Build the explicitly exposed standard controls for the existing Advanced page. */
export function createAdvancedSettingSpecGroups({
    isCouchDB,
}: AdvancedSettingSpecContext): readonly SettingSpecGroup[] {
    return [
        {
            heading: "Memory cache",
            items: [{ key: "hashCacheMaxCount", control: { type: "number", min: 10 } }],
        },
        {
            heading: "Local Database Tweak",
            items: [
                {
                    key: "chunkSplitterVersion",
                    control: { type: "dropdown", options: () => ChunkAlgorithmNames },
                },
                { key: "customChunkSize", control: { type: "number", min: 0, allowZero: true } },
            ],
        },
        {
            heading: "Transfer Tweak",
            items: [
                { key: "readChunksOnline", control: { type: "toggle" }, visible: isCouchDB },
                { key: "useOnlyLocalChunk", control: { type: "toggle" }, visible: isCouchDB },
                {
                    key: "concurrencyOfReadChunksOnline",
                    control: { type: "number", min: 10 },
                    visible: isCouchDB,
                },
                {
                    key: "minimumIntervalOfReadChunksOnline",
                    control: { type: "number", min: 10 },
                    visible: isCouchDB,
                },
                { key: "autoAcceptCompatibleTweak", control: { type: "toggle", defaultValue: true } },
            ],
        },
        {
            heading: "Remote Database Tweak",
            items: [{ key: "enableCompression", control: { type: "toggle" } }],
        },
    ];
}
