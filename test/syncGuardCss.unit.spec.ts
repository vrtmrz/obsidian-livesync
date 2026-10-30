import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

describe("SyncGuard CSS", () => {
    it("closes its bypass rule before the existing status display rules", () => {
        const bypassStart = stylesheet.indexOf(".sls-sync-guard-bypass {");
        const statusStart = stylesheet.indexOf(".livesync-stat-item {", bypassStart);
        expect(bypassStart).toBeGreaterThanOrEqual(0);
        expect(statusStart).toBeGreaterThan(bypassStart);
        const bypassRule = stylesheet.slice(bypassStart, statusStart);
        expect(bypassRule).toMatch(/min-height:\s*44px;/);
        expect(bypassRule).toMatch(/min-width:\s*44px;/);
        expect(bypassRule).toMatch(/}\s*$/);
    });
});
