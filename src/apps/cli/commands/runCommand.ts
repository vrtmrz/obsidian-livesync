import * as fs from "fs/promises";
import * as path from "path";
import { decodeSettingsFromSetupURI } from "@lib/API/processSetting";
import { configURIBase } from "@lib/common/models/shared.const";
import { DEFAULT_SETTINGS, type FilePathWithPrefix, type ObsidianLiveSyncSettings } from "@lib/common/types";
import { stripAllPrefixes } from "@lib/string_and_binary/path";
import type { CLICommandContext, CLIOptions } from "./types";
import { promptForPassphrase, readStdinAsUtf8, toArrayBuffer, toVaultRelativePath } from "./utils";
import { collectPeers, openP2PHost, parseTimeoutSeconds, syncWithPeer } from "./p2p";
import { performFullScan } from "@lib/serviceFeatures/offlineScanner";
import { UnresolvedErrorManager } from "@lib/services/base/UnresolvedErrorManager";

export async function runCommand(options: CLIOptions, context: CLICommandContext): Promise<boolean> {
    const { vaultPath, core, settingsPath } = context;

    await core.services.control.activated;
    if (options.command === "daemon") {
        return true;
    }

    if (options.command === "sync") {
        console.log("[Command] sync");
        const result = await core.services.replication.replicate(true);
        return !!result;
    }

    if (options.command === "p2p-peers") {
        if (options.commandArgs.length < 1) {
            throw new Error("p2p-peers requires one argument: <timeout>");
        }
        const timeoutSec = parseTimeoutSeconds(options.commandArgs[0], "p2p-peers");
        console.error(`[Command] p2p-peers timeout=${timeoutSec}s`);
        const peers = await collectPeers(core as any, timeoutSec);
        if (peers.length > 0) {
            process.stdout.write(peers.map((peer) => `[peer]\t${peer.peerId}\t${peer.name}`).join("\n") + "\n");
        }
        return true;
    }

    if (options.command === "p2p-sync") {
        if (options.commandArgs.length < 2) {
            throw new Error("p2p-sync requires two arguments: <peer> <timeout>");
        }
        const peerToken = options.commandArgs[0].trim();
        if (!peerToken) {
            throw new Error("p2p-sync requires a non-empty <peer>");
        }
        const timeoutSec = parseTimeoutSeconds(options.commandArgs[1], "p2p-sync");
        console.error(`[Command] p2p-sync peer=${peerToken} timeout=${timeoutSec}s`);
        const peer = await syncWithPeer(core as any, peerToken, timeoutSec);
        console.error(`[Done] P2P sync completed with ${peer.name} (${peer.peerId})`);
        return true;
    }

    if (options.command === "p2p-host") {
        console.error("[Command] p2p-host");
        await openP2PHost(core as any);
        console.error("[Ready] P2P host is running. Press Ctrl+C to stop.");
        await new Promise(() => {});
        return true;
    }

    if (options.command === "push") {
        if (options.commandArgs.length < 2) {
            throw new Error("push requires two arguments: <src> <dst>");
        }
        const sourcePath = path.resolve(options.commandArgs[0]);
        const destinationVaultPath = toVaultRelativePath(options.commandArgs[1], vaultPath);
        const sourceData = await fs.readFile(sourcePath);
        const sourceStat = await fs.stat(sourcePath);
        console.log(`[Command] push ${sourcePath} -> ${destinationVaultPath}`);

        await core.serviceModules.storageAccess.writeFileAuto(destinationVaultPath, toArrayBuffer(sourceData), {
            mtime: sourceStat.mtimeMs,
            ctime: sourceStat.ctimeMs,
        });
        const destinationPathWithPrefix = destinationVaultPath as FilePathWithPrefix;
        const stored = await core.serviceModules.fileHandler.storeFileToDB(destinationPathWithPrefix, true);
        return stored;
    }

    if (options.command === "pull") {
        if (options.commandArgs.length < 2) {
            throw new Error("pull requires two arguments: <src> <dst>");
        }
        const sourceVaultPath = toVaultRelativePath(options.commandArgs[0], vaultPath);
        const destinationPath = path.resolve(options.commandArgs[1]);
        console.log(`[Command] pull ${sourceVaultPath} -> ${destinationPath}`);

        const sourcePathWithPrefix = sourceVaultPath as FilePathWithPrefix;
        const restored = await core.serviceModules.fileHandler.dbToStorage(sourcePathWithPrefix, null, true);
        if (!restored) {
            return false;
        }
        const data = await core.serviceModules.storageAccess.readFileAuto(sourceVaultPath);
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        if (typeof data === "string") {
            await fs.writeFile(destinationPath, data, "utf-8");
        } else {
            await fs.writeFile(destinationPath, new Uint8Array(data));
        }
        return true;
    }

    if (options.command === "pull-rev") {
        if (options.commandArgs.length < 3) {
            throw new Error("pull-rev requires three arguments: <src> <dst> <rev>");
        }
        const sourceVaultPath = toVaultRelativePath(options.commandArgs[0], vaultPath);
        const destinationPath = path.resolve(options.commandArgs[1]);
        const rev = options.commandArgs[2].trim();
        if (!rev) {
            throw new Error("pull-rev requires a non-empty revision");
        }
        console.log(`[Command] pull-rev ${sourceVaultPath}@${rev} -> ${destinationPath}`);

        const source = await core.serviceModules.databaseFileAccess.fetch(
            sourceVaultPath as FilePathWithPrefix,
            rev,
            true
        );
        if (!source || source.deleted) {
            return false;
        }

        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        const body = source.body;
        if (body.type === "text/plain") {
            await fs.writeFile(destinationPath, await body.text(), "utf-8");
        } else {
            await fs.writeFile(destinationPath, new Uint8Array(await body.arrayBuffer()));
        }
        return true;
    }

    if (options.command === "setup") {
        if (options.commandArgs.length < 1) {
            throw new Error("setup requires one argument: <setupURI>");
        }
        const setupURI = options.commandArgs[0].trim();
        if (!setupURI.startsWith(configURIBase)) {
            throw new Error(`setup URI must start with ${configURIBase}`);
        }
        const passphrase = await promptForPassphrase();
        const decoded = await decodeSettingsFromSetupURI(setupURI, passphrase);
        if (!decoded) {
            throw new Error("Failed to decode settings from setup URI");
        }
        const nextSettings = {
            ...DEFAULT_SETTINGS,
            ...decoded,
            useIndexedDBAdapter: false,
            isConfigured: true,
        } as ObsidianLiveSyncSettings;

        console.log(`[Command] setup -> ${settingsPath}`);
        await core.services.setting.applyPartial(nextSettings, true);
        await core.services.control.applySettings();
        return true;
    }

    if (options.command === "put") {
        if (options.commandArgs.length < 1) {
            throw new Error("put requires one argument: <dst>");
        }
        const destinationVaultPath = toVaultRelativePath(options.commandArgs[0], vaultPath);
        const content = await readStdinAsUtf8();
        console.log(`[Command] put stdin -> ${destinationVaultPath}`);
        return await core.serviceModules.databaseFileAccess.storeContent(
            destinationVaultPath as FilePathWithPrefix,
            content
        );
    }

    if (options.command === "cat") {
        if (options.commandArgs.length < 1) {
            throw new Error("cat requires one argument: <src>");
        }
        const sourceVaultPath = toVaultRelativePath(options.commandArgs[0], vaultPath);
        console.error(`[Command] cat ${sourceVaultPath}`);
        const source = await core.serviceModules.databaseFileAccess.fetch(
            sourceVaultPath as FilePathWithPrefix,
            undefined,
            true
        );
        if (!source || source.deleted) {
            return false;
        }
        const body = source.body;
        if (body.type === "text/plain") {
            process.stdout.write(await body.text());
        } else {
            const buffer = Buffer.from(await body.arrayBuffer());
            process.stdout.write(new Uint8Array(buffer));
        }
        return true;
    }

    if (options.command === "cat-rev") {
        if (options.commandArgs.length < 2) {
            throw new Error("cat-rev requires two arguments: <src> <rev>");
        }
        const sourceVaultPath = toVaultRelativePath(options.commandArgs[0], vaultPath);
        const rev = options.commandArgs[1].trim();
        if (!rev) {
            throw new Error("cat-rev requires a non-empty revision");
        }
        console.error(`[Command] cat-rev ${sourceVaultPath} @ ${rev}`);
        const source = await core.serviceModules.databaseFileAccess.fetch(
            sourceVaultPath as FilePathWithPrefix,
            rev,
            true
        );
        if (!source || source.deleted) {
            return false;
        }
        const body = source.body;
        if (body.type === "text/plain") {
            process.stdout.write(await body.text());
        } else {
            const buffer = Buffer.from(await body.arrayBuffer());
            process.stdout.write(new Uint8Array(buffer));
        }
        return true;
    }

    if (options.command === "ls") {
        const prefix =
            options.commandArgs.length > 0 && options.commandArgs[0].trim() !== ""
                ? toVaultRelativePath(options.commandArgs[0], vaultPath)
                : "";
        const rows: { path: string; line: string }[] = [];

        for await (const doc of core.services.database.localDatabase.findAllNormalDocs({ conflicts: true })) {
            if (doc._deleted || doc.deleted) {
                continue;
            }
            const docPath = stripAllPrefixes(doc.path);
            if (prefix !== "" && !docPath.startsWith(prefix)) {
                continue;
            }
            const revision = `${doc._rev ?? ""}${(doc._conflicts?.length ?? 0) > 0 ? "*" : ""}`;
            rows.push({
                path: docPath,
                line: `${docPath}\t${doc.size}\t${doc.mtime}\t${revision}`,
            });
        }

        rows.sort((a, b) => a.path.localeCompare(b.path));
        if (rows.length > 0) {
            process.stdout.write(rows.map((e) => e.line).join("\n") + "\n");
        }
        return true;
    }

    if (options.command === "info") {
        if (options.commandArgs.length < 1) {
            throw new Error("info requires one argument: <path>");
        }
        const targetPath = toVaultRelativePath(options.commandArgs[0], vaultPath);

        for await (const doc of core.services.database.localDatabase.findAllNormalDocs({ conflicts: true })) {
            if (doc._deleted || doc.deleted) continue;
            const docPath = stripAllPrefixes(doc.path);
            if (docPath !== targetPath) continue;

            const filename = path.basename(docPath);
            const conflictsText = (doc._conflicts?.length ?? 0) > 0 ? doc._conflicts.join("\n           ") : "N/A";
            const children = "children" in doc ? doc.children : [];
            const rawDoc = await core.services.database.localDatabase.getRaw<any>(doc._id, {
                revs_info: true,
            });
            const pastRevisions = (rawDoc._revs_info ?? [])
                .filter((entry: { rev?: string; status?: string }) => {
                    if (!entry.rev) return false;
                    if (entry.rev === doc._rev) return false;
                    return entry.status === "available";
                })
                .map((entry: { rev: string }) => entry.rev);
            const pastRevisionsText = pastRevisions.length > 0 ? pastRevisions.map((rev: string) => `${rev}`) : ["N/A"];
            const out = {
                id: doc._id,
                revision: doc._rev ?? "",
                conflicts: conflictsText,
                filename: filename,
                path: docPath,
                size: doc.size,
                revisions: pastRevisionsText,
                chunks: children.length,
                children: children,
            };
            process.stdout.write(JSON.stringify(out, null, 2) + "\n");
            return true;
        }

        process.stderr.write(`[Info] File not found: ${targetPath}\n`);
        return false;
    }

    if (options.command === "rm") {
        if (options.commandArgs.length < 1) {
            throw new Error("rm requires one argument: <path>");
        }
        const targetPath = toVaultRelativePath(options.commandArgs[0], vaultPath);
        console.error(`[Command] rm ${targetPath}`);
        return await core.serviceModules.databaseFileAccess.delete(targetPath as FilePathWithPrefix);
    }

    if (options.command === "resolve") {
        if (options.commandArgs.length < 2) {
            throw new Error("resolve requires two arguments: <path> <revision-to-keep>");
        }
        const targetPath = toVaultRelativePath(options.commandArgs[0], vaultPath) as FilePathWithPrefix;
        const revisionToKeep = options.commandArgs[1].trim();
        if (revisionToKeep === "") {
            throw new Error("resolve requires a non-empty revision-to-keep");
        }

        const currentMeta = await core.serviceModules.databaseFileAccess.fetchEntryMeta(targetPath, undefined, true);
        if (currentMeta === false || currentMeta._deleted || currentMeta.deleted) {
            process.stderr.write(`[Info] File not found: ${targetPath}\n`);
            return false;
        }

        const conflicts = await core.serviceModules.databaseFileAccess.getConflictedRevs(targetPath);
        const candidateRevisions = [currentMeta._rev, ...conflicts];
        if (!candidateRevisions.includes(revisionToKeep)) {
            process.stderr.write(`[Info] Revision not found for ${targetPath}: ${revisionToKeep}\n`);
            return false;
        }

        if (conflicts.length === 0 && currentMeta._rev === revisionToKeep) {
            console.error(`[Command] resolve ${targetPath} keep ${revisionToKeep} (already resolved)`);
            return true;
        }

        console.error(`[Command] resolve ${targetPath} keep ${revisionToKeep}`);
        for (const revision of candidateRevisions) {
            if (revision === revisionToKeep) {
                continue;
            }
            const resolved = await core.services.conflict.resolveByDeletingRevision(targetPath, revision, "CLI");
            if (!resolved) {
                process.stderr.write(`[Info] Failed to delete revision ${revision} for ${targetPath}\n`);
                return false;
            }
        }
        return true;
    }

    if (options.command === "mirror") {
        console.error("[Command] mirror");
        const log = (msg: unknown) => console.error(`[Mirror] ${msg}`);
        const errorManager = new UnresolvedErrorManager(core.services.appLifecycle);
        return await performFullScan(core as any, log, errorManager, false, true);
    }

    throw new Error(`Unsupported command: ${options.command}`);
}
