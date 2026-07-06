import { describe, expect, it } from "vitest";
import { getRemoteConfigurationDescription } from "./remoteConfigDisplay";

describe("getRemoteConfigurationDescription", () => {
    it("should mask credentials and query parameters in WebDAV connection strings", () => {
        expect(
            getRemoteConfigurationDescription(
                "sls+webdav://user:pass@example.com/dav?prefix=vault%2F&headers=Authorization%3A%20Bearer%20token"
            )
        ).toBe("https://example.com/dav");
    });
});
