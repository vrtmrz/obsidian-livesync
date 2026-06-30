// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
export declare const SETTING_VERSION_INITIAL = 0;
export declare const SETTING_VERSION_SUPPORT_CASE_INSENSITIVE = 10;
export declare const CURRENT_SETTING_VERSION = 10;
export declare const RemoteTypes: {
    readonly REMOTE_COUCHDB: "";
    readonly REMOTE_MINIO: "MINIO";
    readonly REMOTE_P2P: "ONLY_P2P";
};
export declare const REMOTE_COUCHDB: "";
export declare const REMOTE_MINIO: "MINIO";
export declare const REMOTE_P2P: "ONLY_P2P";
export declare const E2EEAlgorithmNames: {
    readonly "": "V1: Legacy";
    readonly v2: "V2: AES-256-GCM With HKDF";
    readonly forceV1: "Force-V1: Force Legacy (Not recommended)";
};
export declare const E2EEAlgorithms: {
    readonly V1: "";
    readonly V2: "v2";
    readonly ForceV1: "forceV1";
};
export declare const HashAlgorithms: {
    readonly XXHASH32: "xxhash32";
    readonly XXHASH64: "xxhash64";
    readonly MIXED_PUREJS: "mixed-purejs";
    readonly SHA1: "sha1";
    readonly LEGACY: "";
};
export declare const ChunkAlgorithmNames: {
    readonly v1: "V1: Legacy";
    readonly v2: "V2: Simple (Default)";
    readonly "v2-segmenter": "V2.5: Lexical chunks";
    readonly "v3-rabin-karp": "V3: Fine deduplication";
};
export declare const ChunkAlgorithms: {
    readonly V1: "v1";
    readonly V2: "v2";
    readonly V2Segmenter: "v2-segmenter";
    readonly RabinKarp: "v3-rabin-karp";
};
export declare const MODE_SELECTIVE = 0;
export declare const MODE_AUTOMATIC = 1;
export declare const MODE_PAUSED = 2;
export declare const MODE_SHINY = 3;
export declare const NetworkWarningStyles: {
    readonly BANNER: "";
    readonly ICON: "icon";
    readonly HIDDEN: "hidden";
};
