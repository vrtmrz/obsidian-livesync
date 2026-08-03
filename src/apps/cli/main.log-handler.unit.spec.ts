import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
    setLogHandler: vi.fn(),
}));

vi.mock("./services/NodeServiceHub", () => ({
    NodeServiceContext: class {},
    NodeServiceHub: class {
        API = {
            addLog: {
                setHandler: mocks.setLogHandler,
            },
        };
    },
}));

import { main } from "./main";

function createStandardIoMock() {
    return {
        readStdin: vi.fn(async () => ""),
        prompt: vi.fn(async () => ""),
        writeStdout: vi.fn(),
        writeStderr: vi.fn(),
    };
}

describe("CLI log handler", () => {
    const originalArgv = process.argv.slice();
    let databasePath: string;

    beforeEach(async () => {
        databasePath = await mkdtemp(join(tmpdir(), "livesync-cli-log-handler-"));
        mocks.setLogHandler.mockReset();
        mocks.setLogHandler.mockImplementation(() => {
            throw new Error("__LOG_HANDLER_CONFIGURED__");
        });
    });

    afterEach(async () => {
        process.argv = originalArgv.slice();
        await rm(databasePath, { recursive: true, force: true });
    });

    it("replaces the default Headless API log handler", async () => {
        process.argv = ["node", "livesync-cli", databasePath, "remote-ls"];

        await expect(main(createStandardIoMock())).rejects.toThrow("__LOG_HANDLER_CONFIGURED__");
        expect(mocks.setLogHandler).toHaveBeenCalledWith(expect.any(Function), true);
    });
});
