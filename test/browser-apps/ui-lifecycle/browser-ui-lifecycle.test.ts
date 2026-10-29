import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { chromium } from "playwright";

import { observePageFailures, startStaticServer, waitFor } from "../helpers/browser.ts";

type OwnerName = "owner-a" | "owner-b" | "owner-c" | "owner-d";
type DialogOutcome =
    | { readonly kind: "resolved"; readonly value: unknown }
    | { readonly kind: "rejected"; readonly message: string };

interface BrowserUiLifecycleFixture {
    readonly ready: boolean;
    startDialog(name: OwnerName, initialData?: string): void;
    startMenu(name: OwnerName, title: string): void;
    clickSavedBackdrop(name: OwnerName): void;
    hideMenu(name: OwnerName): void;
    unload(name: OwnerName): void;
    abortParent(name: OwnerName): void;
    state(name: OwnerName): {
        readonly dialogs: readonly DialogOutcome[];
        readonly menus: readonly string[];
        readonly hasSavedBackdrop: boolean;
    };
}

declare global {
    interface Window {
        browserUiLifecycle?: BrowserUiLifecycleFixture;
    }
}

const fixtureDist = resolve(import.meta.dirname!, "../../../_testdata/browser-ui-lifecycle");

Deno.test({
    name: "Browser UI: dialogue and menu lifecycles remain owned by their document and plug-in scope",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const server = await startStaticServer(fixtureDist);
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            const assertNoPageFailures = observePageFailures(page);
            await page.goto(server.baseUrl);
            await page.waitForFunction(() => window.browserUiLifecycle?.ready === true);

            const startDialog = async (name: OwnerName, initialData?: string) =>
                await page.evaluate(
                    ({ name, initialData }) => window.browserUiLifecycle!.startDialog(name, initialData),
                    { name, initialData }
                );
            const startMenu = async (name: OwnerName, title: string) =>
                await page.evaluate(({ name, title }) => window.browserUiLifecycle!.startMenu(name, title), {
                    name,
                    title,
                });
            const state = async (name: OwnerName) =>
                await page.evaluate((ownerName) => window.browserUiLifecycle!.state(ownerName), name);

            const ownerA = page.frameLocator("#owner-a");
            const ownerB = page.frameLocator("#owner-b");
            const ownerC = page.frameLocator("#owner-c");
            const ownerD = page.frameLocator("#owner-d");

            await startDialog("owner-a", "A-seed");
            await startDialog("owner-b", "B-seed");
            const initial = await page.evaluate(() => ({
                first: window.browserUiLifecycle!.state("owner-a").dialogs,
                second: window.browserUiLifecycle!.state("owner-b").dialogs,
            }));
            assertEquals(initial, { first: [], second: [] });
            assertNoPageFailures();
            await ownerA.getByTestId("lifecycle-dialog").waitFor();
            await ownerB.getByTestId("lifecycle-dialog").waitFor();
            assertEquals(await page.locator(".dialog-host").count(), 0);
            assertEquals(await ownerA.locator(".dialog-host").count(), 1);
            assertEquals(await ownerB.locator(".dialog-host").count(), 1);

            await ownerA.getByTestId("submit-dialog").click();
            await waitFor(async () => (await state("owner-a")).dialogs.length === 1, "Owner A dialogue did not finish");
            assertEquals((await state("owner-a")).dialogs, [{ kind: "resolved", value: "result:A-seed" }]);
            assertEquals(await ownerA.locator(".dialog-host").count(), 0);
            assertEquals(await ownerB.locator(".dialog-host").count(), 1);

            await ownerB.getByTestId("close-dialog").click();
            await waitFor(async () => (await state("owner-b")).dialogs.length === 1, "Owner B dialogue did not finish");
            assertEquals((await state("owner-b")).dialogs, [{ kind: "resolved", value: "undefined" }]);

            await startMenu("owner-a", "first menu");
            await ownerA.getByText("first menu", { exact: true }).waitFor();
            assertEquals(await page.locator(".background").count(), 0);
            assertEquals(await ownerA.locator(".background").count(), 1);
            assertEquals(await ownerB.locator(".background").count(), 0);

            await startMenu("owner-a", "replacement menu");
            await ownerA.getByText("replacement menu", { exact: true }).waitFor();
            await waitFor(
                async () => (await state("owner-a")).menus.length === 1,
                "Replacing the menu did not close its first promise"
            );
            assertEquals((await state("owner-a")).menus, ["resolved"]);
            assertEquals((await state("owner-a")).hasSavedBackdrop, true);

            await page.evaluate(() => window.browserUiLifecycle!.clickSavedBackdrop("owner-a"));
            assertEquals(await ownerA.locator(".background").count(), 1);
            assertEquals((await state("owner-a")).menus, ["resolved"]);
            await page.evaluate(() => window.browserUiLifecycle!.hideMenu("owner-a"));
            await waitFor(
                async () => (await state("owner-a")).menus.length === 2,
                "Hiding the replacement menu did not finish"
            );
            assertEquals((await state("owner-a")).menus, ["resolved", "resolved"]);
            assertEquals(await ownerA.locator(".background").count(), 0);

            await startDialog("owner-a", "unload-A");
            await startMenu("owner-a", "A unload menu");
            await startDialog("owner-b", "still-B");
            await startMenu("owner-b", "B remains open");
            await ownerA.getByTestId("lifecycle-dialog").waitFor();
            await ownerA.getByText("A unload menu", { exact: true }).waitFor();
            await ownerB.getByTestId("lifecycle-dialog").waitFor();
            await ownerB.getByText("B remains open", { exact: true }).waitFor();

            await page.evaluate(() => window.browserUiLifecycle!.unload("owner-a"));
            await waitFor(
                async () =>
                    (await state("owner-a")).dialogs.length === 2 && (await state("owner-a")).menus.length === 3,
                "Owner A unload did not settle its UI operations"
            );
            assertEquals((await state("owner-a")).dialogs[1], { kind: "rejected", message: "Plug-in unloaded" });
            assertEquals(await ownerA.locator(".dialog-host").count(), 0);
            assertEquals(await ownerA.locator(".background").count(), 0);
            assertEquals(await ownerB.locator(".dialog-host").count(), 1);
            assertEquals(await ownerB.locator(".background").count(), 1);

            await startDialog("owner-a", "after-unload");
            await startMenu("owner-a", "after unload menu");
            await waitFor(
                async () =>
                    (await state("owner-a")).dialogs.length === 3 && (await state("owner-a")).menus.length === 4,
                "Post-unload UI operations did not settle"
            );
            assertEquals((await state("owner-a")).dialogs[2], { kind: "rejected", message: "Plug-in unloaded" });
            assertEquals((await state("owner-a")).menus[3], "resolved");
            assertEquals(await ownerA.locator(".dialog-host").count(), 0);
            assertEquals(await ownerA.locator(".background").count(), 0);

            await startDialog("owner-c", "parent-abort");
            await startMenu("owner-c", "parent abort menu");
            await ownerC.getByTestId("lifecycle-dialog").waitFor();
            await ownerC.getByText("parent abort menu", { exact: true }).waitFor();
            await page.evaluate(() => window.browserUiLifecycle!.abortParent("owner-c"));
            await waitFor(
                async () =>
                    (await state("owner-c")).dialogs.length === 1 && (await state("owner-c")).menus.length === 1,
                "Parent abort did not settle its UI operations"
            );
            assertEquals((await state("owner-c")).dialogs[0], { kind: "rejected", message: "Fixture UI owner ended" });
            assertEquals((await state("owner-c")).menus[0], "resolved");
            assertEquals(await ownerC.locator(".dialog-host").count(), 0);
            assertEquals(await ownerC.locator(".background").count(), 0);
            assertEquals(await ownerB.locator(".dialog-host").count(), 1);
            assertEquals(await ownerB.locator(".background").count(), 1);

            await startDialog("owner-c", "after-parent-abort");
            await startMenu("owner-c", "after parent abort menu");
            await waitFor(
                async () =>
                    (await state("owner-c")).dialogs.length === 2 && (await state("owner-c")).menus.length === 2,
                "Post-abort UI operations did not settle"
            );
            assertEquals((await state("owner-c")).dialogs[1], { kind: "rejected", message: "Fixture UI owner ended" });
            assertEquals((await state("owner-c")).menus[1], "resolved");
            assertEquals(await ownerC.locator(".dialog-host").count(), 0);
            assertEquals(await ownerC.locator(".background").count(), 0);

            await startDialog("owner-d", "pre-aborted");
            await startMenu("owner-d", "pre-aborted menu");
            await waitFor(
                async () =>
                    (await state("owner-d")).dialogs.length === 1 && (await state("owner-d")).menus.length === 1,
                "Pre-aborted UI operations did not settle"
            );
            assertEquals((await state("owner-d")).dialogs[0], { kind: "rejected", message: "Fixture UI owner ended" });
            assertEquals((await state("owner-d")).menus[0], "resolved");
            assertEquals(await ownerD.locator(".dialog-host").count(), 0);
            assertEquals(await ownerD.locator(".background").count(), 0);

            await page.evaluate(() => window.browserUiLifecycle!.hideMenu("owner-b"));
            await waitFor(async () => (await state("owner-b")).menus.length === 1, "Owner B menu did not close");
            await ownerB.getByTestId("close-dialog").click();
            await waitFor(async () => (await state("owner-b")).dialogs.length === 2, "Owner B dialogue did not close");
            assertEquals(await ownerB.locator(".background").count(), 0);
            assertEquals(await ownerB.locator(".dialog-host").count(), 0);
            assertNoPageFailures();
        } finally {
            await browser.close();
            await server.close();
        }
    },
});
