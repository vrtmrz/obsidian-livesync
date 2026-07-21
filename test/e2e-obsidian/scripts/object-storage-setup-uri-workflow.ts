import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import {
    deleteObjectStoragePrefix,
    ensureObjectStorageBucket,
    listObjectStorageObjects,
    loadObjectStorageConfig,
    makeUniqueBucketPrefix,
    type ObjectStorageConfig,
} from "../runner/objectStorage.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import {
    acknowledgeDisabledOptionalFeatures,
    captureAndStartInitialisation,
    confirmFastFetch,
    confirmRebuild,
    enterSetupURI,
    finishInitialisation,
    generateSetupURIFromDevice,
    resumeCompatibilityReviewIfShown,
    skipMissingRemoteConfiguration,
    type SetupArtifact,
    type SetupCaptureNames,
} from "../runner/setupUri.ts";
import {
    captureObsidianElement,
    captureObsidianPage,
    obsidianRemoteDebuggingPort,
    withObsidianPage,
} from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "90000";

const execFileAsync = promisify(execFile);
const captures: SetupCaptureNames = { scenario: "object-storage-setup-uri", guide: "object-storage-setup" };
const noteFromFirst = "E2E/object-storage/from-first.md";
const noteFromSecond = "E2E/object-storage/from-second.md";
const firstContent =
    "# Object Storage from the first device\n\nThis note travelled through the first device's Setup URI.\n";
const secondContent = "# Object Storage from the second device\n\nThis note completed the return journey.\n";

type RunnerContext = {
    binary: string;
    cliBinary: string;
    activeSessions: Set<ObsidianLiveSyncSession>;
};

function sessionEnvironment(port: number): NodeJS.ProcessEnv {
    return { ...process.env, E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT: String(port) };
}

function sessionPorts(): readonly [number, number] {
    const first = obsidianRemoteDebuggingPort(process.env);
    const second = Number(process.env.E2E_OBSIDIAN_SECONDARY_REMOTE_DEBUGGING_PORT ?? first + 1);
    if (!Number.isInteger(second) || second < 1 || second > 65535 || second === first) {
        throw new Error(`Invalid secondary Obsidian remote debugging port: ${second}`);
    }
    return [first, second];
}

async function runDeno(script: string, environment: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execFileAsync(
        "deno",
        [
            "run",
            "--minimum-dependency-age=0",
            "--config=utils/flyio/deno.jsonc",
            "--frozen",
            "--lock=utils/flyio/deno.lock",
            "--allow-env",
            script,
        ],
        { cwd: process.cwd(), env: environment, maxBuffer: 4 * 1024 * 1024 }
    );
    return stdout;
}

async function generateBootstrapSetupURI(
    objectStorage: ObjectStorageConfig,
    bucketPrefix: string
): Promise<SetupArtifact> {
    const setupPassphrase = randomBytes(24).toString("base64url");
    const output = await runDeno("utils/setup/generate_setup_uri.ts", {
        ...process.env,
        remote_type: "s3",
        endpoint: objectStorage.endpoint,
        access_key: objectStorage.accessKey,
        secret_key: objectStorage.secretKey,
        bucket: objectStorage.bucket,
        region: objectStorage.region,
        force_path_style: String(objectStorage.forcePathStyle),
        bucket_prefix: bucketPrefix,
        passphrase: randomBytes(24).toString("base64url"),
        uri_passphrase: setupPassphrase,
    });
    const setupURI = output.split(/\r?\n/u).find((line) => line.startsWith("obsidian://setuplivesync?settings="));
    if (!setupURI) throw new Error("The public Setup URI generator did not emit an Object Storage Setup URI.");
    return { setupURI, setupPassphrase };
}

async function startSession(
    context: RunnerContext,
    vault: TemporaryVault,
    port: number
): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        env: sessionEnvironment(port),
    });
    context.activeSessions.add(session);
    return session;
}

async function stopSessions(context: RunnerContext): Promise<void> {
    for (const session of [...context.activeSessions]) {
        await stopSession(context, session);
    }
}

async function stopSession(context: RunnerContext, session: ObsidianLiveSyncSession): Promise<void> {
    if (!context.activeSessions.has(session)) return;
    await session.app.stop();
    context.activeSessions.delete(session);
}

async function writeNote(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    path: string,
    content: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(content)};`,
            "const folder=path.split('/').slice(0,-1).join('/');",
            "if(folder&&!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);",
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.modify(existing,content);",
            "else await app.vault.create(path,content);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment
    );
    await waitForLocalDatabaseEntry(cliBinary, environment, path);
}

async function waitForPathContent(vault: TemporaryVault, path: string, expected: string): Promise<void> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 30000);
    let lastContent = "";
    while (Date.now() < deadline) {
        try {
            lastContent = await readFile(join(vault.path, path), "utf8");
            if (lastContent === expected) return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${path}. Last content:\n${lastContent}`);
}

async function waitForObjectStorageData(config: ObjectStorageConfig, prefix: string): Promise<void> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_OBJECT_STORAGE_TIMEOUT_MS ?? 30000);
    while (Date.now() < deadline) {
        if ((await listObjectStorageObjects(config, prefix)).length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for Object Storage data under ${prefix}.`);
}

async function captureNote(port: number, path: string, text: string, filename: string): Promise<string> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate((notePath) => {
            const obsidian = globalThis as typeof globalThis & {
                app?: {
                    workspace?: { openLinkText(path: string, sourcePath: string, newLeaf: boolean): Promise<void> };
                };
            };
            return obsidian.app?.workspace?.openLinkText(notePath, "", false);
        }, path);
    });
    await captureObsidianPage(port, `${filename}.full.png`, async (page) => {
        await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 30000 });
    });
    return await captureObsidianElement(port, filename, (page) => page.locator(".workspace-leaf.mod-active").first());
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);

    const objectStorage = await loadObjectStorageConfig();
    const bucketPrefix = makeUniqueBucketPrefix("setup-uri-workflow");
    const bootstrapArtifact = await generateBootstrapSetupURI(objectStorage, bucketPrefix);
    const vaultA = await createTemporaryVault();
    const vaultB = await createTemporaryVault();
    const [portA, portB] = sessionPorts();
    const context: RunnerContext = { binary, cliBinary: cli.binary, activeSessions: new Set() };
    const screenshots: string[] = [];

    try {
        await ensureObjectStorageBucket(objectStorage);
        console.log(`Temporary Object Storage target: ${objectStorage.bucket}/${bucketPrefix}`);

        const sessionA = await startSession(context, vaultA, portA);
        screenshots.push(await enterSetupURI(portA, "new", bootstrapArtifact, captures));
        screenshots.push(await captureAndStartInitialisation(portA, "new", captures));
        screenshots.push(await confirmRebuild(portA, captures));
        screenshots.push(await skipMissingRemoteConfiguration(portA, captures));
        screenshots.push(await acknowledgeDisabledOptionalFeatures(portA, captures));
        const firstState = await finishInitialisation(portA, context.cliBinary, sessionA.cliEnv);
        await resumeCompatibilityReviewIfShown(portA);
        assertEqual(
            firstState.endpoint,
            objectStorage.endpoint,
            "The first device did not activate the Object Storage endpoint."
        );
        assertEqual(
            firstState.bucket,
            objectStorage.bucket,
            "The first device did not activate the Object Storage bucket."
        );
        assertEqual(
            firstState.bucketPrefix,
            bucketPrefix,
            "The first device did not activate the unique bucket prefix."
        );

        await writeNote(context.cliBinary, sessionA.cliEnv, noteFromFirst, firstContent);
        await pushLocalChanges(context.cliBinary, sessionA.cliEnv);
        await waitForObjectStorageData(objectStorage, bucketPrefix);
        const generated = await generateSetupURIFromDevice(portA, randomBytes(24).toString("base64url"), captures);
        if (generated.artifact.setupURI === bootstrapArtifact.setupURI) {
            throw new Error("The first device returned the bootstrap Setup URI instead of generating a new one.");
        }
        screenshots.push(...generated.screenshots);
        await stopSession(context, sessionA);

        const sessionB = await startSession(context, vaultB, portB);
        screenshots.push(await enterSetupURI(portB, "existing", generated.artifact, captures));
        screenshots.push(await captureAndStartInitialisation(portB, "existing", captures));
        screenshots.push(...(await confirmFastFetch(portB, captures)));
        const secondState = await finishInitialisation(portB, context.cliBinary, sessionB.cliEnv);
        await resumeCompatibilityReviewIfShown(portB);
        assertEqual(
            secondState.endpoint,
            objectStorage.endpoint,
            "The second device did not import the Object Storage endpoint."
        );
        assertEqual(
            secondState.bucketPrefix,
            bucketPrefix,
            "The second device did not import the unique bucket prefix."
        );
        await pushLocalChanges(context.cliBinary, sessionB.cliEnv);
        await waitForPathContent(vaultB, noteFromFirst, firstContent);
        screenshots.push(
            await captureNote(
                portB,
                noteFromFirst,
                "Object Storage from the first device",
                "guide-object-storage-setup-first-to-second.png"
            )
        );

        await writeNote(context.cliBinary, sessionB.cliEnv, noteFromSecond, secondContent);
        await pushLocalChanges(context.cliBinary, sessionB.cliEnv);
        await stopSession(context, sessionB);

        const returningSessionA = await startSession(context, vaultA, portA);
        await waitForLiveSyncCoreReady(context.cliBinary, returningSessionA.cliEnv);
        await resumeCompatibilityReviewIfShown(portA);
        await pushLocalChanges(context.cliBinary, returningSessionA.cliEnv);
        await waitForPathContent(vaultA, noteFromSecond, secondContent);
        screenshots.push(
            await captureNote(
                portA,
                noteFromSecond,
                "Object Storage from the second device",
                "guide-object-storage-setup-second-to-first.png"
            )
        );

        console.log(
            `Object Storage Setup URI and two-device roundtrip succeeded. Screenshots: ${screenshots.join(", ")}`
        );
    } finally {
        await stopSessions(context).catch((error: unknown) => {
            console.warn(error instanceof Error ? error.message : error);
        });
        await vaultA.dispose();
        await vaultB.dispose();
        if (process.env.E2E_OBSIDIAN_KEEP_OBJECT_STORAGE !== "true") {
            await deleteObjectStoragePrefix(objectStorage, bucketPrefix).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
