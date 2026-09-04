import { describe, expect, it, vi } from "vitest";
import { performDoctorConsultation } from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import { runConfigDoctor, type ConfigDoctorDependencies } from "./configDoctor";

vi.mock("@vrtmrz/livesync-commonlib/compat/common/configForDoc", async () => {
    const actual = await vi.importActual<typeof import("@vrtmrz/livesync-commonlib/compat/common/configForDoc")>(
        "@vrtmrz/livesync-commonlib/compat/common/configForDoc"
    );
    return {
        ...actual,
        performDoctorConsultation: vi.fn(),
    };
});

function createDependencies() {
    const settings = { isConfigured: true } as never;
    const setSettings = vi.fn();
    const saveSettings = vi.fn(async () => undefined);
    const scheduleRebuild = vi.fn(async () => true);
    const scheduleFetch = vi.fn(async () => true);
    const performRestart = vi.fn();
    const dependencies: ConfigDoctorDependencies = {
        confirm: {} as never,
        translate: String,
        settings,
        setSettings,
        saveSettings,
        rebuilder: { scheduleRebuild, scheduleFetch },
        performRestart,
    };
    return { dependencies, performRestart, saveSettings, scheduleFetch, scheduleRebuild, setSettings, settings };
}

describe("runConfigDoctor", () => {
    it("persists a modified setting and keeps the configured start-up sequence running", async () => {
        const fixture = createDependencies();
        const nextSettings = { isConfigured: true, changed: true } as never;
        vi.mocked(performDoctorConsultation).mockResolvedValue({
            settings: nextSettings,
            shouldRebuild: false,
            shouldRebuildLocal: false,
            isModified: true,
        });

        await expect(runConfigDoctor(fixture.dependencies)).resolves.toBe(true);

        expect(performDoctorConsultation).toHaveBeenCalledWith(
            { confirm: fixture.dependencies.confirm, translate: fixture.dependencies.translate },
            fixture.settings,
            expect.objectContaining({
                activateReason: "updated",
                forceRescan: false,
            })
        );
        expect(fixture.setSettings).toHaveBeenCalledWith(nextSettings);
        expect(fixture.saveSettings).toHaveBeenCalledOnce();
        expect(fixture.performRestart).not.toHaveBeenCalled();
    });

    it("schedules a rebuild and restarts when Doctor requires remote reconstruction", async () => {
        const fixture = createDependencies();
        vi.mocked(performDoctorConsultation).mockResolvedValue({
            settings: fixture.settings,
            shouldRebuild: true,
            shouldRebuildLocal: false,
            isModified: false,
        });

        await expect(runConfigDoctor(fixture.dependencies, false, "manual", true)).resolves.toBe(false);

        expect(fixture.scheduleRebuild).toHaveBeenCalledOnce();
        expect(fixture.scheduleFetch).not.toHaveBeenCalled();
        expect(fixture.performRestart).toHaveBeenCalledOnce();
        expect(performDoctorConsultation).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ activateReason: "manual", forceRescan: true })
        );
    });

    it("schedules a local fetch and restarts when Doctor requires local reconstruction", async () => {
        const fixture = createDependencies();
        vi.mocked(performDoctorConsultation).mockResolvedValue({
            settings: fixture.settings,
            shouldRebuild: false,
            shouldRebuildLocal: true,
            isModified: false,
        });

        await expect(runConfigDoctor(fixture.dependencies)).resolves.toBe(false);

        expect(fixture.scheduleRebuild).not.toHaveBeenCalled();
        expect(fixture.scheduleFetch).toHaveBeenCalledOnce();
        expect(fixture.performRestart).toHaveBeenCalledOnce();
    });

    it("skips both recovery schedules and restart when rebuilds are skipped", async () => {
        const fixture = createDependencies();
        vi.mocked(performDoctorConsultation).mockResolvedValue({
            settings: fixture.settings,
            shouldRebuild: true,
            shouldRebuildLocal: true,
            isModified: false,
        });

        await expect(runConfigDoctor(fixture.dependencies, true)).resolves.toBe(true);

        expect(fixture.scheduleRebuild).not.toHaveBeenCalled();
        expect(fixture.scheduleFetch).not.toHaveBeenCalled();
        expect(fixture.performRestart).not.toHaveBeenCalled();
    });
});
