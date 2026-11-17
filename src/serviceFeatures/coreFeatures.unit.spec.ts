import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { createReplicationFeature } from "./replication";
import { useBasicCommandsFeature } from "./basicCommands";
import { composeCoreFeatures } from "./coreFeatures";
import type { ReflectionRecoveryView } from "./replication/reflectionTargets";

vi.mock("./replication", () => ({ createReplicationFeature: vi.fn() }));
vi.mock("./basicCommands", () => ({ useBasicCommandsFeature: vi.fn() }));

function createRecoveryView(): ReflectionRecoveryView {
    return {
        list: () => [],
        retry: async () => {},
        reconcile: async () => {},
        onChanged: () => () => {},
    };
}

describe("core feature composition", () => {
    beforeEach(() => vi.resetAllMocks());

    it("provides recovery views before host composition and registers shared handlers after add-ons", () => {
        const order: string[] = [];
        const scheduling = {};
        const recovery = createRecoveryView();
        const core = {
            initialiseServiceFeatures: vi.fn(() => {
                order.push("shared features");
                return { replicationScheduling: scheduling };
            }),
        } as unknown as LiveSyncBaseCore;
        vi.mocked(createReplicationFeature).mockImplementation(() => {
            order.push("prepare recovery view");
            return {
                recovery,
                register: () => {
                    order.push("replication handlers");
                },
            };
        });
        vi.mocked(useBasicCommandsFeature).mockImplementation(() => {
            order.push("basic commands");
        });
        const initialiseHost = vi.fn((host, views) => {
            expect(host).toBe(core);
            expect(views.replicationScheduling).toBe(scheduling);
            expect(views.reflectionRecovery).toBe(recovery);
            order.push("host features");
        });
        composeCoreFeatures(core, initialiseHost, () => {
            order.push("add-ons");
        });
        expect(order).toEqual([
            "prepare recovery view",
            "shared features",
            "host features",
            "add-ons",
            "replication handlers",
            "basic commands",
        ]);
    });

    it("leaves late handlers unregistered if host composition fails", () => {
        const register = vi.fn();
        vi.mocked(createReplicationFeature).mockReturnValue({ recovery: createRecoveryView(), register });
        const core = { initialiseServiceFeatures: () => ({}) } as unknown as LiveSyncBaseCore;
        const addOns = vi.fn();
        const failure = new Error("host composition failed");
        expect(() =>
            composeCoreFeatures(
                core,
                () => {
                    throw failure;
                },
                addOns
            )
        ).toThrow(failure);
        expect(addOns).not.toHaveBeenCalled();
        expect(register).not.toHaveBeenCalled();
        expect(useBasicCommandsFeature).not.toHaveBeenCalled();
    });
});
