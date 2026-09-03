import { describe, expect, it, vi } from "vitest";
import { countCompromisedChunks } from "@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation";
import { checkCompromisedChunks, type CompromisedChunksDependencies } from "./compromisedChunks";

vi.mock("@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation", () => ({
    countCompromisedChunks: vi.fn(),
}));

function selectButton(index: number) {
    return async (...args: unknown[]): Promise<string | false> => {
        const buttons = args[1] as readonly string[];
        return buttons[index] ?? false;
    };
}

function createDependencies() {
    const askSelectStringDialogue = vi.fn(selectButton(2));
    const scheduleRebuild = vi.fn(async () => true);
    const scheduleFetch = vi.fn(async () => true);
    const performRestart = vi.fn();
    const getActiveReplicator = vi.fn((): object | undefined => undefined);
    const log = vi.fn();
    const dependencies: CompromisedChunksDependencies = {
        settings: { encrypt: true },
        localDatabase: { localDatabase: {} as never },
        isOnline: true,
        getActiveReplicator,
        confirm: { askSelectStringDialogue },
        rebuilder: { scheduleRebuild, scheduleFetch },
        performRestart,
        log,
    };
    return {
        askSelectStringDialogue,
        dependencies,
        getActiveReplicator,
        log,
        performRestart,
        scheduleFetch,
        scheduleRebuild,
    };
}

describe("checkCompromisedChunks", () => {
    it("skips the database scan when encryption is disabled", async () => {
        const fixture = createDependencies();
        fixture.dependencies.settings.encrypt = false;

        await expect(checkCompromisedChunks(fixture.dependencies)).resolves.toBe(true);

        expect(countCompromisedChunks).not.toHaveBeenCalled();
    });

    it("allows start-up when local and active remote databases contain no compromised chunks", async () => {
        const fixture = createDependencies();
        vi.mocked(countCompromisedChunks).mockResolvedValue(0);

        await expect(checkCompromisedChunks(fixture.dependencies)).resolves.toBe(true);

        expect(fixture.askSelectStringDialogue).not.toHaveBeenCalled();
    });

    it("short-circuits when local chunk inspection fails", async () => {
        const fixture = createDependencies();
        vi.mocked(countCompromisedChunks).mockResolvedValue(false);

        await expect(checkCompromisedChunks(fixture.dependencies)).resolves.toBe(false);

        expect(fixture.askSelectStringDialogue).not.toHaveBeenCalled();
        expect(fixture.performRestart).not.toHaveBeenCalled();
    });

    it("short-circuits when the active remote chunk inspection fails", async () => {
        const fixture = createDependencies();
        const remoteCount = vi.fn(async () => false);
        vi.mocked(countCompromisedChunks).mockResolvedValue(0);
        fixture.getActiveReplicator.mockReturnValue({ countCompromisedChunks: remoteCount });

        await expect(checkCompromisedChunks(fixture.dependencies)).resolves.toBe(false);

        expect(remoteCount).toHaveBeenCalledOnce();
        expect(fixture.askSelectStringDialogue).not.toHaveBeenCalled();
        expect(fixture.scheduleRebuild).not.toHaveBeenCalled();
        expect(fixture.scheduleFetch).not.toHaveBeenCalled();
        expect(fixture.performRestart).not.toHaveBeenCalled();
    });

    it("removes the fetch choice when compromised chunks are found on the remote", async () => {
        const fixture = createDependencies();
        vi.mocked(countCompromisedChunks).mockResolvedValue(1);
        fixture.getActiveReplicator.mockReturnValue({
            countCompromisedChunks: vi.fn(async () => 2),
        });
        fixture.askSelectStringDialogue.mockImplementation(selectButton(1));

        await expect(checkCompromisedChunks(fixture.dependencies)).resolves.toBe(true);

        expect(fixture.askSelectStringDialogue).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Array),
            expect.objectContaining({ timeout: 0 })
        );
        expect(fixture.askSelectStringDialogue.mock.calls[0]?.[1]).toHaveLength(2);
        expect(fixture.scheduleFetch).not.toHaveBeenCalled();
        expect(fixture.log).toHaveBeenCalled();
    });

    it("schedules the selected recovery and stops start-up", async () => {
        const fixture = createDependencies();
        vi.mocked(countCompromisedChunks).mockResolvedValue(1);
        fixture.askSelectStringDialogue.mockImplementation(selectButton(0));

        await expect(checkCompromisedChunks(fixture.dependencies)).resolves.toBe(false);

        expect(fixture.scheduleRebuild).toHaveBeenCalledOnce();
        expect(fixture.scheduleFetch).not.toHaveBeenCalled();
        expect(fixture.performRestart).toHaveBeenCalledOnce();
    });

    it("fetches local-only compromised chunks when FETCH is selected", async () => {
        const fixture = createDependencies();
        vi.mocked(countCompromisedChunks).mockResolvedValue(1);
        fixture.askSelectStringDialogue.mockImplementation(selectButton(1));

        await expect(checkCompromisedChunks(fixture.dependencies)).resolves.toBe(false);

        expect(fixture.askSelectStringDialogue.mock.calls[0]?.[1]).toHaveLength(3);
        expect(fixture.scheduleRebuild).not.toHaveBeenCalled();
        expect(fixture.scheduleFetch).toHaveBeenCalledOnce();
        expect(fixture.performRestart).toHaveBeenCalledOnce();
    });

    it("keeps start-up running when compromised chunks are explicitly dismissed", async () => {
        const fixture = createDependencies();
        vi.mocked(countCompromisedChunks).mockResolvedValue(1);
        fixture.askSelectStringDialogue.mockImplementation(selectButton(2));

        await expect(checkCompromisedChunks(fixture.dependencies)).resolves.toBe(true);

        expect(fixture.scheduleRebuild).not.toHaveBeenCalled();
        expect(fixture.scheduleFetch).not.toHaveBeenCalled();
        expect(fixture.performRestart).not.toHaveBeenCalled();
        expect(fixture.log).toHaveBeenCalled();
    });
});
