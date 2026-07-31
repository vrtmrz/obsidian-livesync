import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    platform: {
        isMobile: false,
    },
    requestUrl: vi.fn(),
}));

vi.mock("@/deps.ts", () => ({
    Platform: mocks.platform,
    requestUrl: mocks.requestUrl,
}));

vi.mock("@/deps", () => ({
    Platform: mocks.platform,
    requestUrl: mocks.requestUrl,
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

describe("ObsidianAPIService.nativeFetch", () => {
    it("converts a binary body supplied with a URL string to an exact ArrayBuffer", async () => {
        mocks.requestUrl.mockResolvedValue({
            arrayBuffer: new ArrayBuffer(0),
            headers: {},
            status: 200,
        });
        const service = createService({});
        const body = new Uint8Array([0, 1, 2, 255]);

        await service.nativeFetch("https://journal.example/object", {
            body: body as BodyInit,
            method: "PUT",
        });

        const transmittedBody = mocks.requestUrl.mock.calls[0][0].body;
        expect(transmittedBody).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(transmittedBody)).toEqual(body);
    });
});
