import { describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";

import {
    createHiddenFileSyncChangeNotifier,
    type HiddenFileSyncChangeNotifierDependencies,
} from "./hiddenFileSyncChangeNotifier.ts";

type ScheduledOperation = {
    key: string;
    timeout: number;
    operation: () => Promise<unknown> | void;
};

function createFixture(overrides: Partial<HiddenFileSyncChangeNotifierDependencies> = {}): {
    notifier: ReturnType<typeof createHiddenFileSyncChangeNotifier>;
    scheduled: ScheduledOperation[];
    settings: { suppressNotifyHiddenFilesChange: boolean };
    configDir: { value: string };
    showConfigurationChangeNotice: ReturnType<typeof vi.fn>;
    hideConfigurationChangeNotice: ReturnType<typeof vi.fn>;
    scheduleTask: ReturnType<typeof vi.fn>;
    cancelTask: ReturnType<typeof vi.fn>;
} {
    const scheduled: ScheduledOperation[] = [];
    const settings = { suppressNotifyHiddenFilesChange: false };
    const configDir = { value: ".obsidian" };
    const showConfigurationChangeNotice = vi.fn();
    const hideConfigurationChangeNotice = vi.fn();
    const scheduleTask = vi.fn<HiddenFileSyncChangeNotifierDependencies["scheduleTask"]>((key, timeout, operation) => {
        scheduled.push({ key, timeout, operation });
    });
    const cancelTask = vi.fn<HiddenFileSyncChangeNotifierDependencies["cancelTask"]>();
    const dependencies: HiddenFileSyncChangeNotifierDependencies = {
        getSettings: () => settings,
        getConfigDir: () => configDir.value,
        scheduleTask,
        cancelTask,
        showConfigurationChangeNotice,
        hideConfigurationChangeNotice,
        ...overrides,
    };

    return {
        notifier: createHiddenFileSyncChangeNotifier(dependencies),
        scheduled,
        settings,
        configDir,
        showConfigurationChangeNotice,
        hideConfigurationChangeNotice,
        scheduleTask,
        cancelTask,
    };
}

describe("Hidden File Sync change notifier", () => {
    it("queues distinct parent folders and flushes them in insertion order", () => {
        const fixture = createFixture();

        fixture.notifier.queueNotification(".obsidian/plugins/alpha/data.json" as FilePath);
        fixture.notifier.queueNotification(".obsidian/plugins/beta/data.json" as FilePath);
        fixture.notifier.queueNotification(".obsidian/plugins/alpha/main.js" as FilePath);

        expect(fixture.scheduleTask).toHaveBeenCalledTimes(3);
        expect(fixture.scheduleTask).toHaveBeenLastCalledWith("notify-config-change", 1000, expect.any(Function));

        fixture.scheduled[fixture.scheduled.length - 1]?.operation();

        expect(fixture.showConfigurationChangeNotice).toHaveBeenCalledWith([
            ".obsidian/plugins/alpha",
            ".obsidian/plugins/beta",
        ]);
    });

    it("uses live suppression and configuration-directory dependencies", () => {
        const fixture = createFixture();

        fixture.settings.suppressNotifyHiddenFilesChange = true;
        fixture.notifier.queueNotification(".obsidian/plugins/suppressed/data.json" as FilePath);
        fixture.settings.suppressNotifyHiddenFilesChange = false;
        fixture.notifier.queueNotification("other/plugins/outside/data.json" as FilePath);
        fixture.configDir.value = "other";
        fixture.notifier.queueNotification("other/plugins/inside/data.json" as FilePath);

        expect(fixture.scheduled).toHaveLength(1);
        fixture.scheduled[0]?.operation();

        expect(fixture.showConfigurationChangeNotice).toHaveBeenCalledWith(["other/plugins/inside"]);
    });

    it("clears the batch before displaying it", () => {
        const fixture = createFixture();
        fixture.showConfigurationChangeNotice.mockImplementation(() => {
            fixture.notifier.queueNotification(".obsidian/plugins/new/data.json" as FilePath);
        });
        fixture.notifier.queueNotification(".obsidian/plugins/old/data.json" as FilePath);

        fixture.scheduled[0]?.operation();
        expect(fixture.showConfigurationChangeNotice).toHaveBeenNthCalledWith(1, [".obsidian/plugins/old"]);

        fixture.scheduled[1]?.operation();
        expect(fixture.showConfigurationChangeNotice).toHaveBeenNthCalledWith(2, [".obsidian/plugins/new"]);
    });

    it("supports the immediate fixture seam without scheduling another task", () => {
        const fixture = createFixture();

        fixture.notifier.showConfigurationChangeNotice([
            ".obsidian/plugins/alpha",
            ".obsidian/plugins/beta",
            ".obsidian/plugins/alpha",
        ]);

        expect(fixture.showConfigurationChangeNotice).toHaveBeenCalledWith([
            ".obsidian/plugins/alpha",
            ".obsidian/plugins/beta",
        ]);
        expect(fixture.scheduleTask).not.toHaveBeenCalled();
    });

    it("cancels pending work, hides the Notice, and ignores later work on disposal", () => {
        const fixture = createFixture();
        fixture.notifier.queueNotification(".obsidian/plugins/example/data.json" as FilePath);

        fixture.notifier.dispose();
        fixture.notifier.dispose();
        fixture.scheduled[0]?.operation();
        fixture.notifier.queueNotification(".obsidian/plugins/later/data.json" as FilePath);

        expect(fixture.cancelTask).toHaveBeenCalledOnce();
        expect(fixture.cancelTask).toHaveBeenCalledWith("notify-config-change");
        expect(fixture.hideConfigurationChangeNotice).toHaveBeenCalledOnce();
        expect(fixture.showConfigurationChangeNotice).not.toHaveBeenCalled();
        expect(fixture.scheduleTask).toHaveBeenCalledOnce();
    });
});
