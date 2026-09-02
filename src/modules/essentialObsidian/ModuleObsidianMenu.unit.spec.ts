import { describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({ addIcon: vi.fn() }));

import {
    REPLICATION_PROGRESS_PRESENTATIONS,
    USER_INITIATED_REPLICATION_AUTHORITY,
} from "@vrtmrz/livesync-commonlib/replication";
import { ModuleObsidianMenu } from "./ModuleObsidianMenu";

describe("ModuleObsidianMenu ribbon", () => {
    it("retains visible progress and full interaction authority", async () => {
        let runRibbonAction: (() => Promise<void>) | undefined;
        const addClass = vi.fn();
        const replicateUserInitiated = vi.fn(async () => ({ status: "completed" as const }));
        const services = {
            API: {
                addLog: vi.fn(),
                addCommand: vi.fn(),
                registerWindow: vi.fn(),
                registerProtocolHandler: vi.fn(),
                addRibbonIcon: vi.fn((_icon: string, _title: string, callback: () => Promise<void>) => {
                    runRibbonAction = callback;
                    return { addClass };
                }),
            },
            replication: { replicateUserInitiated },
        };
        const module = new ModuleObsidianMenu({ _services: services, services } as never);

        await module._everyOnloadStart();
        await runRibbonAction?.();

        expect(replicateUserInitiated).toHaveBeenCalledWith({
            trigger: "manual",
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });
        expect(addClass).toHaveBeenCalledWith("livesync-ribbon-replicate");
    });
});
