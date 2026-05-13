import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "./main";

function mockProcessExit() {
    const exitMock = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`__EXIT__:${code ?? 0}`);
    }) as any);
    return exitMock;
}

describe("CLI parseArgs", () => {
    const originalArgv = process.argv.slice();

    afterEach(() => {
        process.argv = originalArgv.slice();
        vi.restoreAllMocks();
    });

    it("exits 1 when --settings has no value", () => {
        process.argv = ["node", "livesync-cli", "./databasePath", "--settings"];
        const exitMock = mockProcessExit();
        const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(() => parseArgs()).toThrowError("__EXIT__:1");
        expect(exitMock).toHaveBeenCalledWith(1);
        expect(stderr).toHaveBeenCalledWith("Error: Missing value for --settings");
    });

    it("exits 1 when database-path is missing", () => {
        process.argv = ["node", "livesync-cli", "sync"];
        const exitMock = mockProcessExit();
        const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(() => parseArgs()).toThrowError("__EXIT__:1");
        expect(exitMock).toHaveBeenCalledWith(1);
        expect(stderr).toHaveBeenCalledWith("Error: database-path is required");
    });

    it("exits 1 for unknown command after database-path", () => {
        process.argv = ["node", "livesync-cli", "./databasePath", "unknown-cmd"];
        const exitMock = mockProcessExit();
        const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(() => parseArgs()).toThrowError("__EXIT__:1");
        expect(exitMock).toHaveBeenCalledWith(1);
        expect(stderr).toHaveBeenCalledWith("Error: Unknown command 'unknown-cmd'");
    });

    it("exits 0 and prints help for --help", () => {
        process.argv = ["node", "livesync-cli", "--help"];
        const exitMock = mockProcessExit();
        const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(() => parseArgs()).toThrowError("__EXIT__:0");
        expect(exitMock).toHaveBeenCalledWith(0);
        expect(stdout).toHaveBeenCalled();
        const combined = stdout.mock.calls.flat().join("\n");
        expect(combined).toContain("Usage:");
        expect(combined).toContain("livesync-cli <database-path> [options] <command> [command-args]");
    });

    it("parses p2p-peers command and timeout", () => {
        process.argv = ["node", "livesync-cli", "./databasePath", "p2p-peers", "5"];
        const parsed = parseArgs();

        expect(parsed.databasePath).toBe("./databasePath");
        expect(parsed.command).toBe("p2p-peers");
        expect(parsed.commandArgs).toEqual(["5"]);
    });

    it("parses p2p-sync command with peer and timeout", () => {
        process.argv = ["node", "livesync-cli", "./databasePath", "p2p-sync", "peer-1", "12"];
        const parsed = parseArgs();

        expect(parsed.databasePath).toBe("./databasePath");
        expect(parsed.command).toBe("p2p-sync");
        expect(parsed.commandArgs).toEqual(["peer-1", "12"]);
    });

    it("parses p2p-host command", () => {
        process.argv = ["node", "livesync-cli", "./databasePath", "p2p-host"];
        const parsed = parseArgs();

        expect(parsed.databasePath).toBe("./databasePath");
        expect(parsed.command).toBe("p2p-host");
        expect(parsed.commandArgs).toEqual([]);
    });

    it("parses --interval flag with valid integer", () => {
        process.argv = ["node", "livesync-cli", "./vault", "--interval", "30"];
        const parsed = parseArgs();
        expect(parsed.command).toBe("daemon");
        expect(parsed.interval).toBe(30);
    });

    it("parses -i shorthand for --interval", () => {
        process.argv = ["node", "livesync-cli", "./vault", "-i", "10"];
        const parsed = parseArgs();
        expect(parsed.interval).toBe(10);
    });

    it("exits 1 when --interval has no value", () => {
        process.argv = ["node", "livesync-cli", "./vault", "--interval"];
        const exitMock = mockProcessExit();
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() => parseArgs()).toThrowError("__EXIT__:1");
        expect(exitMock).toHaveBeenCalledWith(1);
    });

    it("exits 1 when --interval is not a positive integer", () => {
        process.argv = ["node", "livesync-cli", "./vault", "--interval", "0"];
        const exitMock = mockProcessExit();
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() => parseArgs()).toThrowError("__EXIT__:1");
        expect(exitMock).toHaveBeenCalledWith(1);
    });

    it("exits 1 when --interval is negative", () => {
        process.argv = ["node", "livesync-cli", "./vault", "--interval", "-5"];
        const exitMock = mockProcessExit();
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() => parseArgs()).toThrowError("__EXIT__:1");
    });

    it("exits 1 when --interval is not numeric", () => {
        process.argv = ["node", "livesync-cli", "./vault", "--interval", "abc"];
        const exitMock = mockProcessExit();
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() => parseArgs()).toThrowError("__EXIT__:1");
    });

    it("parses explicit daemon command", () => {
        process.argv = ["node", "livesync-cli", "./vault", "daemon"];
        const parsed = parseArgs();
        expect(parsed.command).toBe("daemon");
        expect(parsed.databasePath).toBe("./vault");
    });

    it("defaults to daemon when no command specified", () => {
        process.argv = ["node", "livesync-cli", "./vault"];
        const parsed = parseArgs();
        expect(parsed.command).toBe("daemon");
    });

    it("parses explicit daemon command with --interval", () => {
        process.argv = ["node", "livesync-cli", "./vault", "daemon", "--interval", "30"];
        const parsed = parseArgs();
        expect(parsed.command).toBe("daemon");
        expect(parsed.interval).toBe(30);
    });
});
