import { withObsidianPage } from "@vrtmrz/obsidian-test-session";

export {
    obsidianRemoteDebuggingPort,
    preseedTrustedVaultState,
    trustVaultIfPrompted,
    withObsidianPage,
} from "@vrtmrz/obsidian-test-session";

export async function clickJsonResolveOption(port: number, mode: "AB" | "BA"): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const option = page.locator(`label:has(input[name="disp"][value="${mode}"])`);
        await option.click({ timeout: 10000 });
        const checked = await page.locator(`input[name="disp"][value="${mode}"]`).isChecked({ timeout: 10000 });
        if (!checked) {
            throw new Error(`JSON Resolve option was not selected: ${mode}`);
        }
        await page.getByRole("button", { name: "Apply" }).click({ timeout: 10000 });
    });
}
