import { afterEach, describe, expect, it, vi } from "vitest";

const { evalObsidianJson } = vi.hoisted(() => ({
    evalObsidianJson: vi.fn(),
}));

vi.mock("./cli.ts", () => ({ evalObsidianJson }));

import { prepareStableRemote } from "./upgradeWorkflow.ts";

describe("stable remote preparation", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it("waits for a readable Security Seed before marking the remote as resolved", async () => {
        vi.stubEnv("E2E_OBSIDIAN_REMOTE_READY_INTERVAL_MS", "0");
        vi.stubEnv("E2E_OBSIDIAN_REMOTE_READY_TIMEOUT_MS", "100");
        evalObsidianJson
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ ok: true });

        await prepareStableRemote("obsidian-cli", {});

        expect(evalObsidianJson).toHaveBeenCalledTimes(4);
        const scripts = evalObsidianJson.mock.calls.map(([, script]) => String(script));
        expect(scripts[0]).toContain("tryCreateRemoteDatabase");
        expect(scripts[0]).not.toContain("markRemoteResolved");
        expect(scripts[1]).toContain("ensurePBKDF2Salt");
        expect(scripts[2]).toContain("ensurePBKDF2Salt");
        expect(scripts[3]).toContain("markRemoteResolved");
    });
});
