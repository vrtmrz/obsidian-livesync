import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");

describe("CLI Docker image", () => {
    it("sets a deterministic readable and executable entrypoint mode", () => {
        expect(dockerfile).toContain("COPY --chmod=755 src/apps/cli/docker-entrypoint.sh /usr/local/bin/livesync-cli");
        expect(dockerfile).not.toContain("RUN chmod +x /usr/local/bin/livesync-cli");
    });
});
