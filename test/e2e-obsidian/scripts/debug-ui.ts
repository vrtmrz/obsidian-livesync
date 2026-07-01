import { launchObsidian } from "../runner/launch.ts";
import { installBuiltPlugin } from "../runner/pluginInstaller.ts";
import { createTemporaryVault } from "../runner/vault.ts";
import { requireObsidianBinary } from "../runner/environment.ts";
import { writeFile } from "node:fs/promises";
import { obsidianRemoteDebuggingPort, preseedTrustedVaultState, withObsidianPage } from "../runner/ui.ts";

const port = obsidianRemoteDebuggingPort();

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const vault = await createTemporaryVault();
    await installBuiltPlugin(vault.path);
    const app = await launchObsidian({
        binary,
        vaultPath: vault.path,
        homePath: vault.homePath,
        xdgConfigPath: vault.xdgConfigPath,
        xdgCachePath: vault.xdgCachePath,
        xdgDataPath: vault.xdgDataPath,
        userDataPath: vault.userDataPath,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
    });

    try {
        await preseedTrustedVaultState(port, vault.id);
        const { screenshotPath, textPath } = await withObsidianPage(port, async (page) => {
            await page.waitForTimeout(Number(process.env.E2E_OBSIDIAN_DEBUG_WAIT_MS ?? 5000));
            const title = await page.title().catch((error: unknown) => `title error: ${String(error)}`);
            const url = page.url();
            const text = await page
                .locator("body")
                .innerText({ timeout: 5000 })
                .catch((error: unknown) => {
                    return `body text error: ${String(error)}`;
                });
            if (process.env.E2E_OBSIDIAN_DEBUG_CLICK_TRUST === "true") {
                await page.getByText("Trust author and enable plugins").click({ timeout: 10000 });
                await page.waitForTimeout(Number(process.env.E2E_OBSIDIAN_DEBUG_AFTER_CLICK_WAIT_MS ?? 3000));
            }
            const screenshotPath = process.env.E2E_OBSIDIAN_DEBUG_SCREENSHOT ?? "/tmp/obsidian-e2e-debug.png";
            const textPath = process.env.E2E_OBSIDIAN_DEBUG_TEXT ?? "/tmp/obsidian-e2e-debug.txt";
            await page.screenshot({ path: screenshotPath, fullPage: true });
            await writeFile(textPath, [`title: ${title}`, `url: ${url}`, "", text].join("\n"), "utf-8");
            return { screenshotPath, textPath };
        });
        console.log(`Temporary vault: ${vault.path}`);
        console.log(`Temporary Obsidian state: ${vault.userDataPath}`);
        console.log(`Debug text: ${textPath}`);
        console.log(`Debug screenshot: ${screenshotPath}`);
    } finally {
        await app.stop();
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
