import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Obsidian dependency barrel
vi.mock("@/deps.ts", () => ({
    Platform: { isMobile: false, isDesktop: true, isDesktopApp: true },
    Notice: vi.fn(),
    App: class MockApp {},
    ItemView: class MockItemView {},
}));

// Mock the DocumentHistoryModal class
const mockOpen = vi.fn();
vi.mock("@/modules/features/DocumentHistory/DocumentHistoryModal.ts", () => {
    return {
        DocumentHistoryModal: class {
            open = mockOpen;
            constructor(app: any, core: any, plugin: any, file: any, id: any) {}
        },
    };
});

import type { DocumentHistoryHost } from "./types.ts";
import { showHistory, fileHistory } from "./historyOperations.ts";

describe("ObsidianDocumentHistory Operations", () => {
    let host: DocumentHistoryHost;
    const mockFindAllDocs = vi.fn();
    const mockAskSelectString = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        host = {
            context: {
                app: {},
                liveSyncPlugin: {},
            },
            services: {
                database: {
                    localDatabase: {
                        findAllDocs: mockFindAllDocs,
                    },
                },
                path: {
                    getPath: vi.fn((doc) => doc._id),
                },
                UI: {
                    confirm: {
                        askSelectString: mockAskSelectString,
                    },
                },
            },
        } as unknown as DocumentHistoryHost;
    });

    describe("showHistory", () => {
        it("opens the DocumentHistoryModal", () => {
            showHistory(host, "test.md" as any, "doc-123" as any);
            expect(mockOpen).toHaveBeenCalledTimes(1);
        });
    });

    describe("fileHistory", () => {
        it("prompts the user and opens history on selection", async () => {
            mockFindAllDocs.mockImplementation(async function* () {
                yield { _id: "file-a.md", mtime: 100 };
                yield { _id: "file-b.md", mtime: 200 };
            });
            mockAskSelectString.mockResolvedValueOnce("file-b.md");

            const log = vi.fn();
            await fileHistory(host, log);

            expect(mockAskSelectString).toHaveBeenCalledWith("File to view History", ["file-b.md", "file-a.md"]);
            expect(mockOpen).toHaveBeenCalledTimes(1);
        });

        it("does nothing if the user cancels selection", async () => {
            mockFindAllDocs.mockImplementation(async function* () {
                yield { _id: "file-a.md", mtime: 100 };
            });
            mockAskSelectString.mockResolvedValueOnce(null);

            const log = vi.fn();
            await fileHistory(host, log);

            expect(mockAskSelectString).toHaveBeenCalledTimes(1);
            expect(mockOpen).not.toHaveBeenCalled();
        });
    });
});
