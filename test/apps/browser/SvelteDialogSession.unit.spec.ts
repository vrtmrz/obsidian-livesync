import { EVENT_PLUGIN_UNLOADED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents.js";
import type {
    ComponentHasResult,
    DialogHostProps,
    SvelteDialogManagerDependencies,
} from "@vrtmrz/livesync-commonlib/compat/services/implements/base/SvelteDialog.js";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context.js";
import type { Component } from "svelte";
import { describe, expect, it, vi } from "vitest";

import {
    SvelteDialogSession,
    type SvelteDialogRenderer,
    type SvelteDialogSurface,
} from "@/modules/services/SvelteDialogSession";

describe("SvelteDialogSession", () => {
    it("mounts, resolves the selected result, and unmounts through the owning surface", async () => {
        const context = createServiceContext();
        const replaceChildren = vi.fn();
        const setTitle = vi.fn();
        const close = vi.fn();
        const mounted = {};
        const unmount = vi.fn().mockResolvedValue(undefined);
        let mountedProps: DialogHostProps<string, string> | undefined;
        const renderer: SvelteDialogRenderer = {
            mount(_dialogHost, _target, props) {
                mountedProps = props as DialogHostProps<string, string>;
                return mounted as never;
            },
            unmount,
        };
        const session = new SvelteDialogSession({
            surface: {
                contentEl: { replaceChildren } as unknown as HTMLElement,
                close,
                setTitle,
            },
            context,
            dependencies: {} as SvelteDialogManagerDependencies<typeof context>,
            dialogHost: (() => {}) as unknown as Component<DialogHostProps>,
            component: (() => {}) as unknown as ComponentHasResult<string, string>,
            initialData: "initial",
            renderer,
        });

        session.onOpen();
        const result = session.waitForClose();
        mountedProps?.setTitle("Dialogue title");
        mountedProps?.setResult("selected");
        session.onClose();

        await expect(result).resolves.toBe("selected");
        expect(replaceChildren).toHaveBeenCalledOnce();
        expect(setTitle).toHaveBeenCalledWith("Dialogue title");
        const getInitialData = mountedProps?.getInitialData;
        expect(getInitialData).toBeTypeOf("function");
        expect(getInitialData?.()).toBe("initial");
        await vi.waitFor(() => expect(unmount).toHaveBeenCalledWith(mounted));
    });

    it("rejects the pending result and closes the surface when the owning context unloads", async () => {
        const context = createServiceContext();
        const close = vi.fn();
        const session = new SvelteDialogSession({
            surface: {
                contentEl: { replaceChildren: vi.fn() } as unknown as HTMLElement,
                close,
                setTitle: vi.fn(),
            },
            context,
            dependencies: {} as SvelteDialogManagerDependencies<typeof context>,
            dialogHost: (() => {}) as unknown as Component<DialogHostProps>,
            component: (() => {}) as unknown as ComponentHasResult<string, string>,
            renderer: {
                mount: () => ({}) as never,
                unmount: vi.fn().mockResolvedValue(undefined),
            },
        });

        session.onOpen();
        const result = session.waitForClose();
        context.events.emitEvent(EVENT_PLUGIN_UNLOADED);

        await expect(result).rejects.toThrow("Plug-in unloaded");
        expect(close).toHaveBeenCalledOnce();
    });
});
