import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { EVENT_PLUGIN_UNLOADED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import type {
    ComponentHasResult,
    DialogHostProps,
    SvelteDialogManagerDependencies,
} from "@vrtmrz/livesync-commonlib/compat/services/implements/base/SvelteDialog";

const rendering = vi.hoisted(() => ({
    mount: vi.fn(),
    unmount: vi.fn(async (_component: unknown) => {}),
    legacy: { document: undefined as Document | undefined },
}));
vi.mock("svelte", async (importOriginal) => ({
    ...(await importOriginal<typeof import("svelte")>()),
    mount: rendering.mount,
    unmount: rendering.unmount,
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions", () => ({
    get _activeDocument() {
        return rendering.legacy.document;
    },
}));
vi.mock("@/modules/services/LiveSyncUI/DialogHost.svelte", () => ({ default: () => {} }));

import {
    BrowserModal,
    BrowserSvelteDialogManager,
    LiveSyncBrowserDialog,
} from "@/apps/browser/BrowserSvelteDialogManager";
import { createBrowserUiScope } from "@/apps/browser/BrowserUiScope";

class TestElement {
    children: TestElement[] = [];
    parentElement: TestElement | null = null;
    hidden = false;
    className = "";
    textContent = "";
    constructor(
        readonly ownerDocument: TestDocument,
        readonly tagName: string
    ) {}
    appendChild(child: TestElement) {
        child.remove();
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    remove() {
        if (this.parentElement)
            this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        this.parentElement = null;
    }
    replaceChildren() {
        for (const child of [...this.children]) child.remove();
    }
}
class TestDocument {
    body = new TestElement(this, "body");
    createElement(tag: string) {
        return new TestElement(this, tag);
    }
}
const asDocument = (document: TestDocument) => document as unknown as Document;
const component = (() => {}) as unknown as ComponentHasResult<string, string>;
type Context = ReturnType<typeof createServiceContext>;
type UiOptions = { document?: Document; signal?: AbortSignal };
function createManager(options?: UiOptions) {
    const context = createServiceContext();
    return {
        context,
        manager: new BrowserSvelteDialogManager(
            context,
            {} as SvelteDialogManagerDependencies<Context>,
            options ? createBrowserUiScope(context, options) : undefined
        ),
    };
}
function lastMount() {
    const call = rendering.mount.mock.calls[rendering.mount.mock.calls.length - 1];
    return { target: call[1].target as TestElement, props: call[1].props as DialogHostProps<string, string> };
}

beforeEach(() => {
    vi.clearAllMocks();
    rendering.legacy.document = asDocument(new TestDocument());
    rendering.mount.mockImplementation(() => ({}));
});
afterEach(() => {
    rendering.legacy.document = undefined;
});

describe("Browser Svelte dialogue ownership", () => {
    it("releases every per-dialogue context subscription on legacy direct close", async () => {
        const subscriptions: ReturnType<typeof vi.fn>[] = [];
        const context = {
            events: {
                onceEvent: vi.fn(() => {
                    const unregister = vi.fn();
                    subscriptions.push(unregister);
                    return unregister;
                }),
            },
        } as unknown as Context;
        const dialog = new LiveSyncBrowserDialog(context, {} as SvelteDialogManagerDependencies<Context>, component);
        dialog.open();
        const result = dialog.waitForClose();
        dialog.close();
        await expect(result).resolves.toBeUndefined();
        expect(subscriptions.length).toBeGreaterThan(0);
        for (const unsubscribe of subscriptions) expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it("preserves the legacy document, normal result, and component cleanup", async () => {
        const { manager } = createManager();
        const result = manager.openSvelteDialog(component, "initial");
        const { target, props } = lastMount();
        expect(target.ownerDocument).toBe(rendering.legacy.document);
        expect(props.getInitialData?.()).toBe("initial");
        props.setResult("selected");
        props.closeDialog();
        await expect(result).resolves.toBe("selected");
        expect((rendering.legacy.document as unknown as TestDocument).body.children).toHaveLength(0);
        expect(rendering.unmount).toHaveBeenCalledOnce();
    });
    it("preserves rejection when the owning context unloads", async () => {
        const { context, manager } = createManager();
        const result = manager.openSvelteDialog(component);
        const rejected = expect(result).rejects.toThrow("Plug-in unloaded");
        context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        await rejected;
        expect(rendering.unmount).toHaveBeenCalledOnce();
        expect((rendering.legacy.document as unknown as TestDocument).body.children).toHaveLength(0);
    });
    it("uses its supplied document even when the legacy document changes before opening", async () => {
        const targetDocument = new TestDocument();
        const { manager } = createManager({ document: asDocument(targetDocument) });
        rendering.legacy.document = asDocument(new TestDocument());
        const result = manager.openSvelteDialog(component);
        const { target, props } = lastMount();
        expect(target.ownerDocument).toBe(targetDocument);
        expect(targetDocument.body.children).toHaveLength(1);
        expect((rendering.legacy.document as unknown as TestDocument).body.children).toHaveLength(0);
        props.closeDialog();
        await expect(result).resolves.toBeUndefined();
    });
    it("aborts one owner without closing another owner's dialogue", async () => {
        const firstOwner = new AbortController();
        const firstDocument = new TestDocument();
        const secondDocument = new TestDocument();
        const first = createManager({ document: asDocument(firstDocument), signal: firstOwner.signal });
        const second = createManager({ document: asDocument(secondDocument) });
        const firstResult = first.manager.openSvelteDialog(component);
        let observedFirst: unknown = "still pending";
        void firstResult.then(
            () => {
                observedFirst = "resolved";
            },
            (error) => {
                observedFirst = error;
            }
        );
        const secondResult = second.manager.openSvelteDialog(component);
        const secondProps = lastMount().props;
        const reason = new Error("fixture owner ended");
        firstOwner.abort(reason);
        await vi.waitFor(() => expect(observedFirst).toBe(reason), { timeout: 1000, interval: 20 });
        expect(firstDocument.body.children).toHaveLength(0);
        expect(secondDocument.body.children).toHaveLength(1);
        secondProps.setResult("second");
        secondProps.closeDialog();
        await expect(secondResult).resolves.toBe("second");
    });
    it("does not render for an already aborted owner or reopen after unload", async () => {
        const owner = new AbortController();
        const reason = new Error("fixture owner ended");
        owner.abort(reason);
        const aborted = createManager({ signal: owner.signal });
        const rejected = aborted.manager.openSvelteDialog(component).catch((error) => error);
        expect(rendering.mount).not.toHaveBeenCalled();
        await expect(rejected).resolves.toBe(reason);
        const unloaded = createManager();
        unloaded.context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        const afterUnload = unloaded.manager.openSvelteDialog(component).catch((error) => error);
        expect(rendering.mount).not.toHaveBeenCalled();
        await expect(afterUnload).resolves.toBeInstanceOf(Error);
    });
    it("keeps a native modal in the document which created its elements", () => {
        const document = new TestDocument();
        const modal = new BrowserModal(asDocument(document));
        rendering.legacy.document = asDocument(new TestDocument());
        modal.open();
        expect(document.body.children).toEqual([modal.baseEl]);
        expect((modal.contentEl as unknown as TestElement).ownerDocument).toBe(document);
        modal.close();
        expect(document.body.children).toHaveLength(0);
    });
});
