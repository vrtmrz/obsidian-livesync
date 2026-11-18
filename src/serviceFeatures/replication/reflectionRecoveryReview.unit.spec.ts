import { describe, expect, it, vi } from "vitest";
import { UICommandRegistry } from "@vrtmrz/livesync-commonlib/ui-commands";
import type { PendingReflection, ReflectionRecoveryView } from "./ReplicateResultProcessor";
import { OPEN_REFLECTION_RECOVERY_REVIEW } from "./reflectionRecoveryCommand";

vi.mock("@/common/translation", () => ({
    $msg: (message: string) => message,
}));

import { useReflectionRecoveryReview } from "./reflectionRecoveryReview";

type Handler = () => Promise<boolean>;

function pending(overrides: Partial<PendingReflection> = {}): PendingReflection {
    return {
        documentId: "doc-a",
        revision: "4-a",
        source: "scan",
        state: "review",
        automaticAttempted: true,
        resources: ["remote"],
        reason: "Chunk transport is unavailable",
        running: false,
        ...overrides,
    };
}

function fixture(options: { initial?: PendingReflection[]; reconcile?: () => Promise<void> } = {}) {
    let current = [...(options.initial ?? [])];
    let noticeVisible = false;
    const listeners = new Set<() => void>();
    const scanHandlers: Handler[] = [];
    const unloadHandlers: Handler[] = [];
    const commands = new UICommandRegistry();
    const confirm = {
        askSelectString: vi.fn(async (_message: string, _items: string[]) => ""),
        askSelectStringDialogue: vi.fn(async (_message: string, buttons: readonly string[]) => buttons[0]),
    };
    const recovery: ReflectionRecoveryView = {
        list: vi.fn(() => current),
        retry: vi.fn(async (_documentIds: readonly string[]) => undefined),
        reconcile: vi.fn(async () => options.reconcile?.()),
        onChanged: vi.fn((listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }),
    };
    const notices = {
        setItem: vi.fn(),
        finish: vi.fn(() => {
            noticeVisible = true;
        }),
        removeItem: vi.fn(),
        hide: vi.fn(() => {
            noticeVisible = false;
        }),
        dispose: vi.fn(),
    };
    const services = {
        API: {},
        UI: { commands, confirm },
        database: {
            localDatabase: {
                getRaw: vi.fn(async (documentId: string) => {
                    if (documentId === "doc-unreadable") {
                        throw new Error("local read failed");
                    }
                    return { _id: documentId, _rev: "1-local", type: "plain", path: `notes/${documentId}.md` };
                }),
            },
        },
        path: { getPath: vi.fn((entry: { path: string }) => entry.path) },
        appLifecycle: {
            onScanningStartupIssues: {
                addHandler: vi.fn((handler: Handler) => {
                    scanHandlers.push(handler);
                    return () => {
                        const index = scanHandlers.indexOf(handler);
                        if (index >= 0) {
                            scanHandlers.splice(index, 1);
                        }
                    };
                }),
            },
            onUnload: {
                addHandler: vi.fn((handler: Handler) => {
                    unloadHandlers.push(handler);
                    return () => {
                        const index = unloadHandlers.indexOf(handler);
                        if (index >= 0) {
                            unloadHandlers.splice(index, 1);
                        }
                    };
                }),
            },
        },
    };

    useReflectionRecoveryReview({ services } as never, recovery, notices as never);

    return {
        commands,
        confirm,
        get current() {
            return current;
        },
        emitChanged: () => {
            for (const listener of [...listeners]) {
                listener();
            }
        },
        get listenerCount() {
            return listeners.size;
        },
        get noticeVisible() {
            return noticeVisible;
        },
        dismissNotice: () => {
            noticeVisible = false;
        },
        notices,
        recovery,
        scan: async () => {
            for (const handler of [...scanHandlers]) {
                await handler();
            }
        },
        setCurrent: (next: PendingReflection[]) => {
            current = next;
        },
        unload: async () => {
            for (const handler of [...unloadHandlers]) {
                await handler();
            }
        },
    };
}

describe("reflection recovery review UI", () => {
    it("describes incomplete resources and retains a legacy reason when resources are unavailable", async () => {
        const context = fixture({
            initial: [
                pending({ documentId: "doc-local", resources: ["local-database"], reason: "local-database" }),
                pending({ documentId: "doc-remote", revision: "4-b", resources: ["remote"], reason: "transport" }),
                pending({
                    documentId: "doc-both",
                    revision: "4-c",
                    resources: ["local-database", "remote"],
                    reason: "transport",
                }),
                pending({ documentId: "doc-legacy", revision: "4-d", resources: [], reason: "local-database" }),
            ],
        });
        await context.scan();

        await context.commands.invoke(OPEN_REFLECTION_RECOVERY_REVIEW, undefined);

        expect(context.confirm.askSelectString.mock.calls[0]?.[1]).toEqual([
            "1. notes/doc-local.md — Needs review — A local database operation failed while the file was being reflected.",
            "2. notes/doc-remote.md — Needs review — Required file content could not be retrieved from the remote while the file was being reflected.",
            "3. notes/doc-both.md — Needs review — A local database operation failed while the file was being reflected. Required file content could not be retrieved from the remote while the file was being reflected.",
            "4. notes/doc-legacy.md — Needs review — The local database connection was unavailable when the file was being reflected.",
        ]);
    });

    it("waits until a running attempt ends before presenting it as needing review", async () => {
        const target = pending({ running: true, reason: "transport" });
        const context = fixture({ initial: [target] });
        await context.scan();
        expect(context.notices.setItem).not.toHaveBeenCalled();
        context.setCurrent([{ ...target, running: false }]);
        context.emitChanged();
        expect(context.notices.setItem).toHaveBeenCalledOnce();
    });

    it("reconciles before coalescing remaining review targets into one startup Notice", async () => {
        const first = pending();
        const second = pending({ documentId: "doc-b", revision: "2-b" });
        let fixtureRef!: ReturnType<typeof fixture>;
        const context = fixture({
            reconcile: async () => {
                fixtureRef.setCurrent([first, second]);
                fixtureRef.emitChanged();
            },
        });
        fixtureRef = context;

        await context.scan();

        expect(context.recovery.reconcile).toHaveBeenCalledOnce();
        expect(context.notices.setItem).toHaveBeenCalledOnce();
        expect(context.notices.finish).toHaveBeenCalledOnce();
        expect(context.notices.setItem.mock.calls[0]?.[2]).toMatchObject({
            message: "Some files could not be reflected in the Vault. Review the affected files.",
            action: { label: "Review files" },
        });
    });

    it("keeps waiting targets distinct from needs-review targets while exposing both to manual review", async () => {
        const context = fixture({ initial: [pending({ state: "waiting", automaticAttempted: false })] });
        context.confirm.askSelectString.mockResolvedValueOnce(
            "1. notes/doc-a.md — Waiting — Required file content could not be retrieved from the remote while the file was being reflected."
        );
        context.confirm.askSelectStringDialogue.mockResolvedValueOnce("Close");

        await context.scan();
        const result = await context.commands.invoke(OPEN_REFLECTION_RECOVERY_REVIEW, undefined);

        expect(result).toMatchObject({ status: "handled", value: "closed" });
        expect(context.notices.finish).not.toHaveBeenCalled();
        expect(context.confirm.askSelectString).toHaveBeenCalledWith(
            "Choose a file to review. Each entry shows its state and reason.",
            [
                "1. notes/doc-a.md — Waiting — Required file content could not be retrieved from the remote while the file was being reflected.",
            ]
        );
        expect(context.confirm.askSelectStringDialogue.mock.calls[0]?.[0]).toContain("Waiting");
        expect(context.recovery.retry).not.toHaveBeenCalled();
    });

    it("does not re-show a dismissed target for runtime updates, but notifies once for a new revision", async () => {
        const original = pending();
        const context = fixture({ initial: [original] });
        await context.scan();
        expect(context.noticeVisible).toBe(true);
        context.dismissNotice();
        context.notices.finish.mockClear();

        context.emitChanged();
        context.setCurrent([{ ...original, running: true }]);
        context.emitChanged();
        expect(context.notices.finish).not.toHaveBeenCalled();
        expect(context.noticeVisible).toBe(false);

        context.setCurrent([{ ...original, revision: "5-new" }]);
        context.emitChanged();
        expect(context.notices.finish).toHaveBeenCalledOnce();
        expect(context.noticeVisible).toBe(true);
    });

    it("hides the summary after resolution without mutating processor records", async () => {
        const unresolved = pending();
        const context = fixture({ initial: [unresolved] });
        await context.scan();
        context.setCurrent([]);

        context.emitChanged();

        expect(context.notices.removeItem).toHaveBeenCalledWith("reflection-recovery-review", "pending-targets");
        expect(context.notices.hide).toHaveBeenCalledWith("reflection-recovery-review");
        expect(context.recovery.retry).not.toHaveBeenCalled();
        expect(context.current).toEqual([]);
    });

    it("retries only the selected target once and keeps the live status without claiming success", async () => {
        const original = pending();
        const context = fixture({ initial: [original] });
        context.confirm.askSelectString
            .mockResolvedValueOnce(
                "1. notes/doc-a.md — Needs review — Required file content could not be retrieved from the remote while the file was being reflected."
            )
            .mockResolvedValueOnce("");
        context.confirm.askSelectStringDialogue.mockResolvedValueOnce("Retry this file");
        vi.mocked(context.recovery.retry).mockImplementation(async (documentIds) => {
            context.setCurrent([{ ...original, running: true }]);
            context.emitChanged();
            expect(documentIds).toEqual(["doc-a"]);
        });
        await context.scan();

        await context.commands.invoke(OPEN_REFLECTION_RECOVERY_REVIEW, undefined);

        expect(context.recovery.retry).toHaveBeenCalledOnce();
        expect(context.recovery.retry).toHaveBeenCalledWith(["doc-a"]);
        expect(context.current).toEqual([{ ...original, running: true }]);
        expect(context.confirm.askSelectString).toHaveBeenCalledTimes(2);
        expect(context.confirm.askSelectString.mock.calls[1]?.[1]?.[0]).toContain("Retry running");
        expect(context.confirm.askSelectStringDialogue.mock.calls[0]?.[0]).not.toMatch(/success|completed/i);
    });

    it("keeps unreadable metadata in the review list using its document ID and reason", async () => {
        const context = fixture({ initial: [pending({ documentId: "doc-unreadable" })] });
        context.confirm.askSelectString.mockResolvedValueOnce("");
        await context.scan();

        await context.commands.invoke(OPEN_REFLECTION_RECOVERY_REVIEW, undefined);

        expect(context.confirm.askSelectString).toHaveBeenCalledWith(
            "Choose a file to review. Each entry shows its state and reason.",
            [
                "1. doc-unreadable — Needs review — Required file content could not be retrieved from the remote while the file was being reflected.",
            ]
        );
        expect(context.recovery.list()).toHaveLength(1);
    });

    it("does not open a second review dialogue while one is active", async () => {
        const context = fixture({ initial: [pending()] });
        let closeSelection!: (value: string) => void;
        context.confirm.askSelectString.mockImplementation(
            () => new Promise<string>((resolve) => (closeSelection = resolve))
        );
        await context.scan();

        const first = context.commands.invoke(OPEN_REFLECTION_RECOVERY_REVIEW, undefined);
        await vi.waitFor(() => expect(context.confirm.askSelectString).toHaveBeenCalledOnce());
        const second = await context.commands.invoke(OPEN_REFLECTION_RECOVERY_REVIEW, undefined);

        expect(second).toEqual({ status: "handled", value: "already-open" });
        expect(context.confirm.askSelectString).toHaveBeenCalledOnce();
        closeSelection("");
        await expect(first).resolves.toMatchObject({ status: "handled", value: "closed" });
    });

    it("unregisters and ignores a dialogue response after unload", async () => {
        const context = fixture({ initial: [pending()] });
        let selectTarget!: (value: string) => void;
        context.confirm.askSelectString.mockImplementation(
            () => new Promise<string>((resolve) => (selectTarget = resolve))
        );
        await context.scan();

        const invocation = context.commands.invoke(OPEN_REFLECTION_RECOVERY_REVIEW, undefined);
        await vi.waitFor(() => expect(context.confirm.askSelectString).toHaveBeenCalledOnce());
        await context.unload();
        context.setCurrent([]);
        context.emitChanged();
        selectTarget(
            "1. notes/doc-a.md — Needs review — Required file content could not be retrieved from the remote while the file was being reflected."
        );

        await expect(invocation).resolves.toMatchObject({ status: "handled", value: "unavailable" });
        expect(context.listenerCount).toBe(0);
        expect(context.confirm.askSelectStringDialogue).not.toHaveBeenCalled();
        expect(context.recovery.retry).not.toHaveBeenCalled();
        await expect(context.commands.invoke(OPEN_REFLECTION_RECOVERY_REVIEW, undefined)).resolves.toEqual({
            status: "unavailable",
        });
    });
});
