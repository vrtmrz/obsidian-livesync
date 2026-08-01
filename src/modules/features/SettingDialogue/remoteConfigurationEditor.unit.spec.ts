import { describe, expect, it } from "vitest";

import {
    DEFAULT_SETTINGS,
    REMOTE_WEBDAV,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import {
    describeRemoteConfiguration,
    remoteTypeForRemoteConfiguration,
    serializeRemoteConfiguration,
    suggestRemoteConfigurationName,
} from "./remoteConfigurationEditor.ts";

describe("remote configuration editor helpers", () => {
    it("maps, names, and serialises an Adaptive WebDAV profile", () => {
        const repositoryId = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        const settings = {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_WEBDAV,
            webDAVactiveConnectionURI:
                "sls+webdav://alice:secret@dav.example/remote.php/dav/files/alice?prefix=notes%2F",
            expectedRepositoryId: repositoryId,
            journalFormat: "adaptive-v1" as const,
            packReadPolicy: "range" as const,
        } as ObsidianLiveSyncSettings;

        const uri = serializeRemoteConfiguration(settings);
        const parsed = ConnectionStringParser.parse(uri);

        expect(parsed.type).toBe("webdav");
        expect(remoteTypeForRemoteConfiguration(parsed)).toBe(REMOTE_WEBDAV);
        expect(suggestRemoteConfigurationName(parsed)).toBe("WebDAV dav.example");
        expect(uri).toContain("journalFormat=adaptive-v1");
        expect(uri).toContain("packReadPolicy=range");
        expect(uri).toContain(`expectedRepositoryId=${repositoryId}`);
    });

    it("does not expose WebDAV credentials or custom headers in the saved-connection description", () => {
        const uri =
            "sls+webdav://alice:secret@dav.example/remote.php/dav/files/alice" +
            "?prefix=notes%2F&headers=Authorization%3A+Bearer+private-token";

        const description = describeRemoteConfiguration(uri);

        expect(description).toBe("https://dav.example");
        expect(description).not.toContain("alice");
        expect(description).not.toContain("secret");
        expect(description).not.toContain("private-token");
    });
});
