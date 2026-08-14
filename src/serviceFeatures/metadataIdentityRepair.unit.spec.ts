import { describe, expect, it, vi } from "vitest";

import type { DocumentID } from "@vrtmrz/livesync-commonlib/compat/common/types.js";
import type {
    MetadataDocumentRepairRequest,
    MetadataDocumentRepairResult,
} from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner.js";
import { executeMetadataIdentityRepair } from "./metadataIdentityRepair";

const request: MetadataDocumentRepairRequest = {
    actualDocumentId: "f:stale" as DocumentID,
    expectedDocumentId: "f:expected" as DocumentID,
    sourceRevision: "4-source",
};

function createDependencies() {
    const events: string[] = [];
    return {
        events,
        confirm: vi.fn(async () => true),
        repair: vi.fn(async (): Promise<MetadataDocumentRepairResult> => {
            events.push("repair");
            return {
                status: "completed" as const,
                ...request,
                targetCreated: true,
            };
        }),
        requestOrdinaryScan: vi.fn(async () => {
            events.push("scan");
            return true;
        }),
    };
}

describe("executeMetadataIdentityRepair", () => {
    it("performs no mutation when the separate confirmation is cancelled", async () => {
        const dependencies = createDependencies();
        dependencies.confirm.mockResolvedValue(false);

        await expect(executeMetadataIdentityRepair(request, dependencies)).resolves.toEqual({
            status: "cancelled",
        });
        expect(dependencies.repair).not.toHaveBeenCalled();
        expect(dependencies.requestOrdinaryScan).not.toHaveBeenCalled();
    });

    it("requests an ordinary scan only after Commonlib completes the exact repair", async () => {
        const dependencies = createDependencies();

        await expect(executeMetadataIdentityRepair(request, dependencies)).resolves.toMatchObject({
            status: "repair-result",
            result: { status: "completed" },
            scanCompleted: true,
        });
        expect(dependencies.repair).toHaveBeenCalledWith(request);
        expect(dependencies.requestOrdinaryScan).toHaveBeenCalledOnce();
        expect(dependencies.repair.mock.invocationCallOrder[0]).toBeLessThan(
            dependencies.requestOrdinaryScan.mock.invocationCallOrder[0]
        );
        expect(dependencies.events).toEqual(["repair", "scan"]);
    });

    it("keeps a completed repair distinct when the ordinary scan cannot start", async () => {
        const dependencies = createDependencies();
        dependencies.requestOrdinaryScan.mockResolvedValue(false);

        await expect(executeMetadataIdentityRepair(request, dependencies)).resolves.toMatchObject({
            status: "repair-result",
            result: { status: "completed" },
            scanCompleted: false,
        });
        expect(dependencies.requestOrdinaryScan).toHaveBeenCalledOnce();
        expect(dependencies.events).toEqual(["repair"]);
    });

    it("keeps a completed repair distinct when requesting the ordinary scan throws", async () => {
        const dependencies = createDependencies();
        const error = new Error("scan unavailable");
        dependencies.requestOrdinaryScan.mockRejectedValue(error);

        await expect(executeMetadataIdentityRepair(request, dependencies)).resolves.toMatchObject({
            status: "repair-result",
            result: { status: "completed" },
            scanCompleted: false,
            scanError: error,
        });
        expect(dependencies.events).toEqual(["repair"]);
    });

    it("does not scan after a stale, blocked, or failed repair result", async () => {
        for (const status of ["stale", "blocked", "failed"] as const) {
            const dependencies = createDependencies();
            dependencies.repair.mockResolvedValue({
                status,
                ...request,
                targetCreated: false,
            });

            await expect(executeMetadataIdentityRepair(request, dependencies)).resolves.toMatchObject({
                status: "repair-result",
                result: { status },
                scanCompleted: false,
            });
            expect(dependencies.requestOrdinaryScan).not.toHaveBeenCalled();
        }
    });
});
