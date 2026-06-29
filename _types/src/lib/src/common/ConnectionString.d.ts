// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { CouchDBConnection, BucketSyncSetting, P2PConnectionInfo } from "./models/setting.type";
export type RemoteConfigurationResult = {
    type: "couchdb";
    settings: CouchDBConnection;
} | {
    type: "s3";
    settings: BucketSyncSetting;
} | {
    type: "p2p";
    settings: P2PConnectionInfo;
} | {
    type: "webdav";
    settings: never;
};
export declare class ConnectionStringParser {
    /**
     * Restore settings from URI
     */
    static parse(uriString: string): RemoteConfigurationResult;
    /**
     * 設定からURIを生成する
     */
    static serialize(config: RemoteConfigurationResult): string;
    private static parseCouchDB;
    private static serializeCouchDB;
    private static parseS3;
    private static serializeS3;
    private static parseP2P;
    private static serializeP2P;
}
