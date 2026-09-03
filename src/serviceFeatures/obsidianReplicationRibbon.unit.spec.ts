import { describe, expect, it, vi } from "vitest";

const addIcon = vi.hoisted(() => vi.fn());
vi.mock("@/deps.ts", () => ({ addIcon }));

import {
    REPLICATION_PROGRESS_PRESENTATIONS,
    USER_INITIATED_REPLICATION_AUTHORITY,
} from "@vrtmrz/livesync-commonlib/replication";
import { $msg } from "@/common/translation";
import { useObsidianReplicationRibbonFeature, type ObsidianReplicationRibbonHost } from "./obsidianReplicationRibbon";

describe("useObsidianReplicationRibbonFeature", () => {
    it("registers the established icon and ribbon callback during initialisation", async () => {
        let initialise: (() => Promise<unknown>) | undefined;
        let ribbonCallback: (() => Promise<void>) | undefined;
        const addClass = vi.fn();
        const replicateUserInitiated = vi.fn(async () => ({ status: "completed" as const }));
        const addRibbonIcon = vi.fn((_icon: string, _title: string, callback: () => Promise<void>) => {
            ribbonCallback = callback;
            return { addClass } as unknown as HTMLElement;
        });
        const host = {
            services: {
                API: { addRibbonIcon },
                appLifecycle: {
                    onInitialise: {
                        addHandler: vi.fn((handler: () => Promise<unknown>) => {
                            initialise = handler;
                        }),
                    },
                },
                replication: { replicateUserInitiated },
            },
        } as unknown as ObsidianReplicationRibbonHost;

        useObsidianReplicationRibbonFeature(host);

        expect(addIcon).not.toHaveBeenCalled();
        expect(addRibbonIcon).not.toHaveBeenCalled();

        await expect(initialise?.()).resolves.toBe(true);

        expect(addIcon).toHaveBeenCalledWith("replicate", expect.any(String));
        expect(addRibbonIcon).toHaveBeenCalledWith(
            "replicate",
            $msg("moduleObsidianMenu.replicate"),
            expect.any(Function)
        );
        expect(addClass).toHaveBeenCalledWith("livesync-ribbon-replicate");

        await ribbonCallback?.();
        expect(replicateUserInitiated).toHaveBeenCalledWith({
            trigger: "manual",
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });
    });
});
