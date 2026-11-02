import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserMenuHarness = vi.hoisted(() => {
    const createDocument = () => {
        const created: { tag: string; removed: boolean; remove: ReturnType<typeof vi.fn> }[] = [];
        const appended: unknown[] = [];
        const document = {
            createElement: vi.fn((tag: string) => {
                const element: { tag: string; removed: boolean; remove: ReturnType<typeof vi.fn> } = {
                    tag,
                    removed: false,
                    remove: vi.fn(() => {
                        element.removed = true;
                    }),
                };
                created.push(element);
                return element;
            }),
            body: {
                appendChild: vi.fn((element: unknown) => {
                    appended.push(element);
                    return element;
                }),
            },
        };
        return { document, created, appended };
    };

    return {
        documents: {
            active: createDocument(),
            explicit: createDocument(),
        },
        mounts: [] as {
            component: unknown;
            target: unknown;
            props: Record<string, unknown>;
            handle: { id: number };
        }[],
        unmounts: [] as unknown[],
    };
});

vi.mock("@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions", () => ({
    _activeDocument: browserMenuHarness.documents.active.document,
}));
vi.mock("svelte", () => ({
    mount: vi.fn((component: unknown, options: { target: unknown; props: Record<string, unknown> }) => {
        const handle = { id: browserMenuHarness.mounts.length };
        browserMenuHarness.mounts.push({ component, target: options.target, props: options.props, handle });
        return handle;
    }),
    unmount: vi.fn((handle: unknown) => {
        browserMenuHarness.unmounts.push(handle);
        return Promise.resolve();
    }),
}));

import { Menu, MenuItem, MenuSeparator } from "@/apps/browser/BrowserMenu";

type BrowserMenuOptionsFixture = { document?: Document; signal?: AbortSignal };

function menuWithOptions(options: BrowserMenuOptionsFixture): Menu {
    const MenuWithOptions = Menu as unknown as new (options: BrowserMenuOptionsFixture) => Menu;
    return new MenuWithOptions(options);
}

function explicitDocument(): Document {
    return browserMenuHarness.documents.explicit.document as unknown as Document;
}

function closeMenu(index: number): () => void {
    const close = browserMenuHarness.mounts[index]!.props.closeMenu;
    if (typeof close !== "function") throw new Error("Menu mount did not receive a close callback");
    return close as () => void;
}

async function settlesAfterMicrotask(promise: Promise<void>): Promise<boolean> {
    let settled = false;
    void promise.then(() => {
        settled = true;
    });
    await Promise.resolve();
    return settled;
}

beforeEach(() => {
    browserMenuHarness.documents.active.created.length = 0;
    browserMenuHarness.documents.active.appended.length = 0;
    browserMenuHarness.documents.explicit.created.length = 0;
    browserMenuHarness.documents.explicit.appended.length = 0;
    browserMenuHarness.mounts.length = 0;
    browserMenuHarness.unmounts.length = 0;
    vi.clearAllMocks();
});

afterEach(() => {
    for (const mount of browserMenuHarness.mounts) {
        const close = mount.props.closeMenu;
        if (typeof close === "function") (close as () => void)();
    }
});

describe("browser Menu lifecycle", () => {
    it("preserves item, separator, chained construction, and positioned display APIs", async () => {
        const menu = new Menu();
        const handler = vi.fn(async () => {});

        expect(
            menu.addItem((item) => {
                item.setTitle("Open").setIcon("folder").onClick(handler);
            })
        ).toBe(menu);
        expect(menu.addSeparator()).toBe(menu);
        expect(menu.items[0]).toBeInstanceOf(MenuItem);
        expect(menu.items[0]).toMatchObject({ type: "item", title: "Open", icon: "folder", handler });
        expect(menu.items[1]).toBeInstanceOf(MenuSeparator);

        const displayed = menu.showAtPosition({ x: 12, y: 34 });
        expect(browserMenuHarness.documents.active.document.createElement).toHaveBeenCalledWith("div");
        expect(browserMenuHarness.documents.active.appended).toEqual([browserMenuHarness.mounts[0]!.target]);
        expect(browserMenuHarness.mounts[0]!.props).toMatchObject({ items: menu.items, x: 12, y: 34 });
        expect(browserMenuHarness.mounts[0]!.target).toBe(browserMenuHarness.documents.active.created[0]);
        closeMenu(0)();
        await expect(displayed).resolves.toBeUndefined();
    });

    it("keeps the returned close promise pending until a menu close action", async () => {
        const menu = new Menu();
        const displayed = menu.showAtPosition({ x: 1, y: 2 });

        expect(await settlesAfterMicrotask(displayed)).toBe(false);
        closeMenu(0)();
        await expect(displayed).resolves.toBeUndefined();
    });

    it("resolves the active display promise when hidden without a menu action", async () => {
        const menu = new Menu();
        const displayed = menu.showAtPosition({ x: 1, y: 2 });

        menu.hide();

        await expect(displayed).resolves.toBeUndefined();
    });

    it("closes a replaced display while keeping the replacement active", async () => {
        const menu = new Menu();
        const first = menu.showAtPosition({ x: 1, y: 2 });
        const staleClose = closeMenu(0);
        const firstElement = browserMenuHarness.mounts[0]!.target as { removed: boolean };
        const second = menu.showAtPosition({ x: 3, y: 4 });
        const secondElement = browserMenuHarness.mounts[1]!.target as { removed: boolean };

        await expect(first).resolves.toBeUndefined();
        expect(firstElement.removed).toBe(true);
        expect(secondElement.removed).toBe(false);
        expect(menu.waitingForClose?.promise).toBe(second);
        expect(await settlesAfterMicrotask(second)).toBe(false);

        try {
            staleClose();
            expect(menu.waitingForClose?.promise).toBe(second);
            expect(secondElement.removed).toBe(false);
            expect(await settlesAfterMicrotask(second)).toBe(false);
        } finally {
            closeMenu(1)();
        }
        await expect(second).resolves.toBeUndefined();
    });

    it("mounts a menu in its explicitly supplied document", async () => {
        const menu = menuWithOptions({ document: explicitDocument() });

        const displayed = menu.showAtPosition({ x: 5, y: 6 });

        expect(browserMenuHarness.documents.explicit.document.createElement).toHaveBeenCalledWith("div");
        expect(browserMenuHarness.documents.explicit.appended).toEqual([browserMenuHarness.mounts[0]!.target]);
        expect(browserMenuHarness.mounts[0]!.target).toBe(browserMenuHarness.documents.explicit.created[0]);
        expect(browserMenuHarness.documents.active.document.createElement).not.toHaveBeenCalled();
        closeMenu(0)();
        await expect(displayed).resolves.toBeUndefined();
    });

    it("aborting one menu closes only that menu", async () => {
        const firstOwner = new AbortController();
        const secondOwner = new AbortController();
        const firstMenu = menuWithOptions({ document: explicitDocument(), signal: firstOwner.signal });
        const secondMenu = menuWithOptions({ document: explicitDocument(), signal: secondOwner.signal });
        const first = firstMenu.showAtPosition({ x: 1, y: 2 });
        const second = secondMenu.showAtPosition({ x: 3, y: 4 });
        let firstSettled = false;
        void first.then(() => {
            firstSettled = true;
        });
        firstOwner.abort();

        await Promise.resolve();
        expect(firstSettled).toBe(true);
        expect(secondMenu.waitingForClose?.promise).toBe(second);
        expect(await settlesAfterMicrotask(second)).toBe(false);
        closeMenu(1)();
        await expect(second).resolves.toBeUndefined();
    });

    it("does not mount for an already aborted owner", async () => {
        const owner = new AbortController();
        owner.abort();
        const menu = menuWithOptions({ document: explicitDocument(), signal: owner.signal });

        const displayed = menu.showAtPosition({ x: 1, y: 2 });

        expect(browserMenuHarness.mounts).toHaveLength(0);
        expect(await settlesAfterMicrotask(displayed)).toBe(true);
    });

    it("does not mount again after its owner aborts", async () => {
        const owner = new AbortController();
        const menu = menuWithOptions({ document: explicitDocument(), signal: owner.signal });
        const first = menu.showAtPosition({ x: 1, y: 2 });
        owner.abort();

        expect(await settlesAfterMicrotask(first)).toBe(true);
        const reopened = menu.showAtPosition({ x: 3, y: 4 });
        expect(await settlesAfterMicrotask(reopened)).toBe(true);
        expect(browserMenuHarness.mounts).toHaveLength(1);
    });

    it.each(["hide", "dismissal", "replacement", "abort"] as const)(
        "unmounts each Svelte component exactly once for %s",
        async (reason) => {
            const owner = new AbortController();
            const menu = menuWithOptions({ document: explicitDocument(), signal: owner.signal });
            const first = menu.showAtPosition({ x: 1, y: 2 });
            let second: Promise<void> | undefined;

            if (reason === "hide") {
                menu.hide();
            } else if (reason === "dismissal") {
                closeMenu(0)();
            } else if (reason === "replacement") {
                second = menu.showAtPosition({ x: 3, y: 4 });
                closeMenu(1)();
            } else {
                owner.abort();
            }

            expect(await settlesAfterMicrotask(first)).toBe(true);
            if (second) expect(await settlesAfterMicrotask(second)).toBe(true);
            for (const mount of browserMenuHarness.mounts) {
                expect(browserMenuHarness.unmounts.filter((handle) => handle === mount.handle)).toHaveLength(1);
            }
        }
    );

    it("removes the menu element before resolving the close promise", async () => {
        const menu = new Menu();
        const displayed = menu.showAtPosition({ x: 1, y: 2 });
        const element = browserMenuHarness.mounts[0]!.target as { removed: boolean };
        let removedWhenResolved = false;
        void displayed.then(() => {
            removedWhenResolved = element.removed;
        });

        menu.hide();

        await displayed;
        expect(removedWhenResolved).toBe(true);
    });

    it("removes its abort listener when closed so a later abort does not unmount it again", async () => {
        const owner = new AbortController();
        const addListener = vi.spyOn(owner.signal, "addEventListener");
        const removeListener = vi.spyOn(owner.signal, "removeEventListener");
        const menu = menuWithOptions({ document: explicitDocument(), signal: owner.signal });
        const displayed = menu.showAtPosition({ x: 1, y: 2 });
        const handle = browserMenuHarness.mounts[0]!.handle;

        menu.hide();
        await expect(displayed).resolves.toBeUndefined();
        owner.abort();

        expect(addListener.mock.calls.map(([type]) => type)).toContain("abort");
        expect(removeListener.mock.calls.map(([type]) => type)).toContain("abort");
        expect(browserMenuHarness.unmounts.filter((unmounted) => unmounted === handle)).toHaveLength(1);
    });
});
