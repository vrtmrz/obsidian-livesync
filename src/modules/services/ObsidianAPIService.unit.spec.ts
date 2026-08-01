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
    it("normalises a typed-array body when the request URL is a string", async () => {
        mocks.requestUrl.mockResolvedValue({
            arrayBuffer: new Uint8Array([9, 8, 7]).buffer,
            headers: { etag: '"created"' },
            status: 201,
        });
        const source = new Uint8Array([0, 1, 2, 3, 4]);
        const body = source.subarray(1, 4);

        const response = await createService({}).nativeFetch("http://127.0.0.1:8088/dav/probe.bin", {
            body: body as unknown as BodyInit,
            headers: { "Content-Type": "application/octet-stream" },
            method: "PUT",
        });

        expect(response.status).toBe(201);
        const request = mocks.requestUrl.mock.calls[0][0] as { body?: unknown };
        expect(request.body).toBeInstanceOf(ArrayBuffer);
        expect([...new Uint8Array(request.body as ArrayBuffer)]).toEqual([1, 2, 3]);
    });

    it("constructs a bodyless response for a successful DELETE", async () => {
        mocks.requestUrl.mockResolvedValue({
            arrayBuffer: new ArrayBuffer(0),
            headers: {},
            status: 204,
        });

        const response = await createService({}).nativeFetch("http://127.0.0.1:8088/dav/probe.bin", {
            method: "DELETE",
        });

        expect(response.status).toBe(204);
        expect(await response.text()).toBe("");
    });
});
