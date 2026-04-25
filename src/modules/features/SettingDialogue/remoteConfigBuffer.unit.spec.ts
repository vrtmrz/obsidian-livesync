import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, REMOTE_COUCHDB, REMOTE_MINIO } from "../../../lib/src/common/types";
import { syncActivatedRemoteSettings } from "./remoteConfigBuffer";

describe("syncActivatedRemoteSettings", () => {
    it("should copy active MinIO credentials into the editing buffer", () => {
        const target = {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_COUCHDB,
            activeConfigurationId: "old-remote",
            accessKey: "",
            secretKey: "",
            endpoint: "",
            bucket: "",
            region: "",
            encrypt: true,
        };
        const source = {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_MINIO,
            activeConfigurationId: "remote-s3",
            accessKey: "access",
            secretKey: "secret",
            endpoint: "https://minio.example.test",
            bucket: "vault",
            region: "sz-hq",
            bucketPrefix: "folder/",
            useCustomRequestHandler: false,
            forcePathStyle: true,
            bucketCustomHeaders: "",
        };

        syncActivatedRemoteSettings(target, source);

        expect(target.remoteType).toBe(REMOTE_MINIO);
        expect(target.activeConfigurationId).toBe("remote-s3");
        expect(target.accessKey).toBe("access");
        expect(target.secretKey).toBe("secret");
        expect(target.endpoint).toBe("https://minio.example.test");
        expect(target.bucket).toBe("vault");
        expect(target.region).toBe("sz-hq");
        expect(target.bucketPrefix).toBe("folder/");
        expect(target.encrypt).toBe(true);
    });

    it("should clear stale dirty values from a different remote type", () => {
        const target = {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_MINIO,
            activeConfigurationId: "remote-s3",
            accessKey: "access",
            secretKey: "secret",
            endpoint: "https://minio.example.test",
            bucket: "vault",
            region: "sz-hq",
            couchDB_URI: "https://edited.invalid",
            couchDB_USER: "edited-user",
            couchDB_PASSWORD: "edited-pass",
            couchDB_DBNAME: "edited-db",
        };
        const source = {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_MINIO,
            activeConfigurationId: "remote-s3",
            accessKey: "access",
            secretKey: "secret",
            endpoint: "https://minio.example.test",
            bucket: "vault",
            region: "sz-hq",
            couchDB_URI: "https://current.example.test",
            couchDB_USER: "current-user",
            couchDB_PASSWORD: "current-pass",
            couchDB_DBNAME: "current-db",
        };

        syncActivatedRemoteSettings(target, source);

        expect(target.couchDB_URI).toBe("https://current.example.test");
        expect(target.couchDB_USER).toBe("current-user");
        expect(target.couchDB_PASSWORD).toBe("current-pass");
        expect(target.couchDB_DBNAME).toBe("current-db");
    });
});
