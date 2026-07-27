import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    platform: {
        isMobile: false,
    },
}));

vi.mock("@/deps.ts", () => ({
    Platform: mocks.platform,
    requestUrl: vi.fn(),
}));

vi.mock("@/deps", () => ({
    Platform: mocks.platform,
    requestUrl: vi.fn(),
}));

vi.mock("@/modules/essentialObsidian/APILib/ObsHttpHandler", () => ({
    ObsHttpHandler: class {},
}));

vi.mock("./ObsidianConfirm", () => ({
    ObsidianConfirm: class {},
}));

import { ObsidianAPIService } from "./ObsidianAPIService";
import type { ObsidianServiceContext } from "./ObsidianServiceContext";

function createService(workspace: Record<string, unknown>, isMobile = false): ObsidianAPIService {
    return new ObsidianAPIService({
        app: { workspace, isMobile },
    } as unknown as ObsidianServiceContext);
}

beforeEach(() => {
    mocks.platform.isMobile = false;
    vi.clearAllMocks();
});

describe("ObsidianAPIService.showWindowOnRight", () => {
    it("keeps the status view in the right leaf on mobile", async () => {
        mocks.platform.isMobile = true;
        const rightLeaf = {
            setViewState: vi.fn().mockResolvedValue(undefined),
        };
        const workspace = {
            getLeavesOfType: vi.fn(() => []),
            getLeaf: vi.fn(),
            getRightLeaf: vi.fn(() => rightLeaf),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
        };
        const service = createService(workspace, true);

        expect(service.isMobile()).toBe(true);
        await service.showWindowOnRight("p2p-status");

        expect(workspace.getLeavesOfType).toHaveBeenCalledWith("p2p-status");
        expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
        expect(workspace.getLeaf).not.toHaveBeenCalled();
        expect(rightLeaf.setViewState).toHaveBeenCalledWith({
            type: "p2p-status",
            active: false,
        });
        expect(workspace.revealLeaf).toHaveBeenCalledWith(rightLeaf);
    });
});
