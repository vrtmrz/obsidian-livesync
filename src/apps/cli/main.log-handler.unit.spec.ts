import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LOG_LEVEL } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    Logger,
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_URGENT,
    LOG_LEVEL_VERBOSE,
    setGlobalLogFunction,
} from "octagonal-wheels/common/logger";

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

async function invokeGlobalLogger(databasePath: string, message: string, level: LOG_LEVEL, debug = false) {
    process.argv = ["node", "livesync-cli", databasePath, ...(debug ? ["--debug"] : []), "remote-ls"];
    const standardIo = createStandardIoMock();
    mocks.setLogHandler.mockImplementation(() => {
        Logger(message, level);
        throw new Error("__LOG_HANDLER_CONFIGURED__");
    });

    await expect(main(standardIo)).rejects.toThrow("__LOG_HANDLER_CONFIGURED__");
    return standardIo;
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
        setGlobalLogFunction(() => {});
        await rm(databasePath, { recursive: true, force: true });
    });

    it("replaces the default Headless API log handler", async () => {
        process.argv = ["node", "livesync-cli", databasePath, "remote-ls"];

        await expect(main(createStandardIoMock())).rejects.toThrow("__LOG_HANDLER_CONFIGURED__");
        expect(mocks.setLogHandler).toHaveBeenCalledWith(expect.any(Function), true);
    });

    it.each([
        ["NOTICE", LOG_LEVEL_NOTICE],
        ["URGENT", LOG_LEVEL_URGENT],
        ["DEBUG", LOG_LEVEL_DEBUG],
        ["INFO", LOG_LEVEL_INFO],
        ["VERBOSE", LOG_LEVEL_VERBOSE],
    ] as const)("keeps Commonlib %s diagnostics hidden by default", async (name, level) => {
        const message = `Commonlib ${name} diagnostic`;
        const standardIo = await invokeGlobalLogger(databasePath, message, level);

        expect(standardIo.writeStderr).not.toHaveBeenCalledWith(expect.stringContaining(message));
        expect(standardIo.writeStdout).not.toHaveBeenCalledWith(expect.stringContaining(message));
    });

    it("writes detailed Commonlib diagnostics to stderr in debug mode", async () => {
        const messages = [
            ["NOTICE", LOG_LEVEL_NOTICE],
            ["URGENT", LOG_LEVEL_URGENT],
            ["DEBUG", LOG_LEVEL_DEBUG],
            ["INFO", LOG_LEVEL_INFO],
            ["VERBOSE", LOG_LEVEL_VERBOSE],
        ] as const;
        process.argv = ["node", "livesync-cli", databasePath, "--debug", "remote-ls"];
        const standardIo = createStandardIoMock();
        mocks.setLogHandler.mockImplementation(() => {
            for (const [name, level] of messages) Logger(`Commonlib ${name} diagnostic`, level);
            throw new Error("__LOG_HANDLER_CONFIGURED__");
        });

        await expect(main(standardIo)).rejects.toThrow("__LOG_HANDLER_CONFIGURED__");

        for (const [name, level] of messages) {
            expect(standardIo.writeStderr).toHaveBeenCalledWith(
                expect.stringContaining(`[${level}] Commonlib ${name} diagnostic\n`)
            );
        }
        expect(standardIo.writeStdout).not.toHaveBeenCalledWith(expect.stringContaining("Commonlib"));
    });
});
