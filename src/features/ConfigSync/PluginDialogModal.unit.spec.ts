import { beforeEach, describe, expect, it, vi } from "vitest";

const svelteMocks = vi.hoisted(() => ({
    mount: vi.fn(),
    unmount: vi.fn(),
}));

vi.mock("svelte", () => svelteMocks);
vi.mock("@/deps.ts", () => ({
    Modal: class Modal {
        contentEl = { setCssStyles: vi.fn() };
        titleEl = { setText: vi.fn() };
    },
}));
vi.mock("./PluginPane.svelte", () => ({ default: "PluginPane" }));

import { PluginDialogModal } from "./PluginDialogModal.ts";

describe("PluginDialogModal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("mounts the focused views once and releases the component on close", () => {
        const component = { component: "customisation-sync" };
        const customisationSync = { catalogue: {} };
        const hiddenFileSync = { initialiseInternalFileSync: vi.fn() };
        svelteMocks.mount.mockReturnValue(component);

        const modal = new PluginDialogModal({} as never, customisationSync as never, hiddenFileSync);
        modal.onOpen();
        modal.onOpen();

        expect(svelteMocks.mount).toHaveBeenCalledOnce();
        expect(svelteMocks.mount).toHaveBeenCalledWith("PluginPane", {
            target: modal.contentEl,
            props: { customisationSync, hiddenFileSync },
        });
        expect(modal.isOpened()).toBe(true);

        modal.onClose();

        expect(svelteMocks.unmount).toHaveBeenCalledWith(component);
        expect(modal.isOpened()).toBe(false);
    });
});
