import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    events: [] as string[],
    sessions: [] as Array<{ app: { stop: ReturnType<typeof vi.fn> } }>,
    vaultCount: 0,
}));

vi.mock("./cli.ts", () => ({
    evalObsidianJson: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./couchdb.ts", () => ({
    assertCouchDbReachable: vi.fn(async () => undefined),
    createCouchDbDatabase: vi.fn(async () => undefined),
    deleteCouchDbDatabase: vi.fn(async () => undefined),
    loadCouchDbConfig: vi.fn(async () => ({
        uri: "http://localhost:5984",
        username: "admin",
        password: "password",
        dbPrefix: "e2e",
    })),
    makeUniqueDatabaseName: vi.fn((_prefix: string, suffix: string) => suffix),
    waitForCouchDbDocs: vi.fn(async () => undefined),
}));

vi.mock("./environment.ts", () => ({
    discoverObsidianCli: vi.fn(() => ({ binary: "obsidian-cli", checked: [] })),
    requireObsidianBinary: vi.fn(() => "Obsidian"),
}));

vi.mock("./pathAssertions.ts", () => ({
    waitForExactCaseOnlyRename: vi.fn(async () => undefined),
}));

vi.mock("./liveSyncWorkflow.ts", () => ({
    assertEqual: vi.fn(),
    assertE2eCompatibilityMarker: vi.fn(async () => undefined),
    assertE2eCompatibilityReviewPending: vi.fn(async () => undefined),
    configureCouchDb: vi.fn(async () => undefined),
    createE2eCouchDbPluginData: vi.fn(() => ({})),
    prepareRemote: vi.fn(async () => undefined),
    pushLocalChanges: vi.fn(async () => {
        throw new Error("simulated Obsidian CLI timeout");
    }),
    resumeCompatibilityReview: vi.fn(async () => undefined),
    waitForLiveSyncCoreReady: vi.fn(async () => undefined),
    waitForLocalDatabaseEntry: vi.fn(async () => ({ id: "note-id", children: [] })),
}));

vi.mock("./session.ts", () => ({
    startObsidianLiveSyncSession: vi.fn(async () => {
        const session = {
            app: {
                stop: vi.fn(async () => {
                    state.events.push("session:stop");
                }),
            },
            cliEnv: {},
            remoteDebuggingPort: 28052,
        };
        state.sessions.push(session);
        return session;
    }),
}));

vi.mock("./vault.ts", () => ({
    createTemporaryVault: vi.fn(async () => {
        state.vaultCount += 1;
        const name = `vault-${state.vaultCount}`;
        return {
            name,
            path: `/tmp/${name}`,
            dispose: vi.fn(async () => {
                state.events.push(`${name}:dispose`);
            }),
        };
    }),
}));

describe("two-vault runner lifecycle", () => {
    beforeEach(() => {
        vi.resetModules();
        state.events.length = 0;
        state.sessions.length = 0;
        state.vaultCount = 0;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("stops the active Obsidian session before disposing temporary Vaults when synchronisation fails", async () => {
        let resolveExit!: (code: number) => void;
        const exitCode = new Promise<number>((resolve) => {
            resolveExit = resolve;
        });
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(process, "exit").mockImplementation((code) => {
            resolveExit(Number(code));
            return undefined as never;
        });

        await import("../scripts/two-vault-sync.ts");

        expect(await exitCode).toBe(1);
        expect(state.sessions).toHaveLength(1);
        expect(state.sessions[0].app.stop).toHaveBeenCalledOnce();
        expect(state.events.indexOf("session:stop")).toBeLessThan(state.events.indexOf("vault-1:dispose"));
    });
});
