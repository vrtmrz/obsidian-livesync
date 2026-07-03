import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

type CreatedNote = {
    path: string;
    read: string;
    exists: boolean;
};

type ReadNote = {
    exists: boolean;
    read: string | null;
};

const notePath = "E2E/real-vault-reflection.md";
const noteContent = [
    "# Real Obsidian E2E",
    "",
    "This note was created through Obsidian's own vault API.",
    `Created at: ${new Date().toISOString()}`,
    "",
].join("\n");

async function waitForFileContent(vaultPath: string, path: string, expectedContent: string): Promise<void> {
    const fullPath = join(vaultPath, path);
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 10000);
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            const content = await readFile(fullPath, "utf-8");
            if (content === expectedContent) {
                return;
            }
            lastError = new Error(`Unexpected content in ${fullPath}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for reflected vault file: ${fullPath}\nLast error: ${String(lastError)}`);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
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

        const created = await evalObsidianJson<CreatedNote>(
            cli.binary,
            [
                "(async()=>{",
                `const path=${JSON.stringify(notePath)};`,
                `const content=${JSON.stringify(noteContent)};`,
                "if(!(await app.vault.adapter.exists('E2E'))) await app.vault.createFolder('E2E');",
                "const existing=app.vault.getAbstractFileByPath(path);",
                "if(existing) await app.vault.delete(existing);",
                "const file=await app.vault.create(path,content);",
                "const read=await app.vault.read(file);",
                "return JSON.stringify({path:file.path,read,exists:await app.vault.adapter.exists(path)});",
                "})()",
            ].join(""),
            session.cliEnv
        );

        assertEqual(created.path, notePath, "Obsidian created the note at an unexpected path.");
        assertEqual(created.exists, true, "Obsidian adapter did not report the created note.");
        assertEqual(created.read, noteContent, "Obsidian did not read back the created note content.");

        await waitForFileContent(vault.path, notePath, noteContent);

        const readBack = await evalObsidianJson<ReadNote>(
            cli.binary,
            [
                "(async()=>{",
                `const path=${JSON.stringify(notePath)};`,
                "const file=app.vault.getAbstractFileByPath(path);",
                "return JSON.stringify({exists:!!file,read:file?await app.vault.read(file):null});",
                "})()",
            ].join(""),
            session.cliEnv
        );
        assertEqual(readBack.exists, true, "Obsidian did not find the reflected note on read-back.");
        assertEqual(readBack.read, noteContent, "Obsidian read-back content did not match the reflected file.");

        console.log(`Created and verified reflected note: ${notePath}`);
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
