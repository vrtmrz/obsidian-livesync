import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertObsidianServiceContextContract,
    inspectObsidianServiceContextContract,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const BASIC_COMMAND_IDS = [
    "livesync-replicate",
    "livesync-dump",
    "livesync-toggle",
    "livesync-suspendall",
    "livesync-scan-files",
    "livesync-runbatch",
    "livesync-abortsync",
] as const;

type ObsidianCommandHost = typeof globalThis & {
    app?: { commands?: { commands?: Record<string, unknown> } };
};

async function assertMenuFeaturesAreComposed(remoteDebuggingPort: number): Promise<void> {
    await withObsidianPage(remoteDebuggingPort, async (page) => {
        const registered = await page.evaluate((commandIds) => {
            const commands = (globalThis as ObsidianCommandHost).app?.commands?.commands ?? {};
            return commandIds.filter((id) => commands[`obsidian-livesync:${id}`] !== undefined);
        }, BASIC_COMMAND_IDS);
        if (registered.length !== BASIC_COMMAND_IDS.length) {
            const missing = BASIC_COMMAND_IDS.filter((id) => !registered.includes(id));
            throw new Error(`Extracted basic commands were not composed: ${missing.join(", ")}`);
        }

        const ribbonCount = await page.locator(".livesync-ribbon-replicate").count();
        if (ribbonCount !== 1) {
            throw new Error(`Expected one extracted replication ribbon action, found ${ribbonCount}.`);
        }

        const preservedRibbonPathCount = await page
            .locator('.livesync-ribbon-replicate path[d*="c-7.66 1.98-12.2 9.61-10 17"]')
            .count();
        if (preservedRibbonPathCount !== 1) {
            throw new Error("The extracted replication ribbon does not preserve its established icon path.");
        }
    });
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;
    try {
        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault: ${vault.path}`);

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        console.log(`Installed plug-in artifacts: ${session.install.copied.join(", ")}`);
        const { readiness } = session;
        console.log(
            `Obsidian plug-in ready: ${readiness.pluginId}@${readiness.pluginVersion} in ${readiness.vaultName}`
        );
        const contextContract = await inspectObsidianServiceContextContract(cli.binary, session.cliEnv);
        assertObsidianServiceContextContract(contextContract);
        console.log(
            `Obsidian service Context contract passed: ${contextContract.contextType}, ${contextContract.serviceContextMismatches.length} mismatches.`
        );
        await assertMenuFeaturesAreComposed(session.remoteDebuggingPort);
        console.log("Extracted basic commands and replication ribbon were composed exactly once.");
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.E2E_OBSIDIAN_SMOKE_TIMEOUT_MS ?? 1000)));
        console.log("Obsidian stayed alive after the plug-in readiness check.");
    } finally {
        if (session) {
            await session.app.stop();
        }
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
