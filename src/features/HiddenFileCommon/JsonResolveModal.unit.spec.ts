import { describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { sendSignal } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { JsonResolveModal } from "./JsonResolveModal.ts";

vi.mock("@/deps.ts", () => ({
    App: class App {},
    Modal: class Modal {
        contentEl = { empty: vi.fn() };
        close() {
            (this as { onClose?: () => void }).onClose?.();
        }
    },
}));
vi.mock("./JsonResolvePane.svelte", () => ({ default: {} }));
vi.mock("svelte", () => ({ mount: vi.fn(), unmount: vi.fn() }));

describe("JsonResolveModal completion", () => {
    it("applies a selection once when closing the dialogue", async () => {
        const filename = ".obsidian/selected-once.json" as FilePath;
        const callback = vi.fn(async () => {});
        const modal = new JsonResolveModal({} as never, filename, [], callback);

        await modal.UICallback("2-kept");

        expect(callback).toHaveBeenCalledExactlyOnceWith("2-kept", undefined);
        sendSignal(`cancel-internal-conflict:${filename}`);
    });

    it("ignores a late selection after cancellation", async () => {
        const filename = ".obsidian/cancelled-once.json" as FilePath;
        const callback = vi.fn(async () => {});
        const modal = new JsonResolveModal({} as never, filename, [], callback);

        sendSignal(`cancel-internal-conflict:${filename}`);
        await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
        await modal.UICallback("2-stale");

        expect(callback).toHaveBeenCalledExactlyOnceWith(undefined);
    });

    it("keeps an admitted write pending when cancellation closes its dialogue", async () => {
        const filename = ".obsidian/writing-once.json" as FilePath;
        let finish!: () => void;
        const gate = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const callback = vi.fn(async () => await gate);
        const modal = new JsonResolveModal({} as never, filename, [], callback);
        const close = vi.spyOn(modal, "close");
        let completed = false;
        const selected = modal.UICallback("2-kept").then(() => {
            completed = true;
        });

        try {
            sendSignal(`cancel-internal-conflict:${filename}`);
            await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());

            expect(callback).toHaveBeenCalledExactlyOnceWith("2-kept", undefined);
            expect(completed).toBe(false);
        } finally {
            finish();
            await selected;
        }
    });
});
