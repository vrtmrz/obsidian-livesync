import { decodeSettingsFromSetupURI } from "@lib/API/processSetting";
import { configURIBase } from "@lib/common/models/shared.const";
import {
    DEFAULT_SETTINGS,
    MILESTONE_DOCID,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    type EntryMilestoneInfo,
    type EntryDoc,
} from "@lib/common/types";
import { ConnectionStringParser } from "@lib/common/ConnectionString";
import { activateRemoteConfiguration, createRemoteConfigurationId } from "@lib/serviceFeatures/remoteConfig";
import { stripAllPrefixes } from "@lib/string_and_binary/path";
import type { CLICommandContext, CLIOptions } from "./types";
import { promptForPassphrase, readStdinAsUtf8, toArrayBuffer, toDatabaseRelativePath } from "./utils";
import { collectPeers, openP2PHost, parseTimeoutSeconds, syncWithPeer } from "./p2p";
import { performFullScan } from "@lib/serviceFeatures/offlineScanner";
import { UnresolvedErrorManager } from "@lib/services/base/UnresolvedErrorManager";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";
import { fsPromises as fs, path } from "@/apps/cli/node-compat";
import type { LiveSyncCouchDBReplicator } from "@lib/replication/couchdb/LiveSyncReplicator";
import type { LiveSyncJournalReplicator } from "@lib/replication/journal/LiveSyncJournalReplicator";

function redactConnectionString(uri: string): string {
    return uri.replace(/\/\/([^@/]+)@/u, "//***@");
}

async function verifyRemoteState(
    core: CLICommandContext["core"],
    settings: ObsidianLiveSyncSettings
): Promise<boolean> {
    const replicator = core.services.replicator.getActiveReplicator();
    if (!replicator) {
        process.stderr.write("[Verification] No active replicator found\n");
        return false;
    }

    if (!replicator.nodeid) {
        await replicator.initializeDatabaseForReplication();
    }

    try {
        let milestone: EntryMilestoneInfo | false | undefined = undefined;
        if (settings.remoteType === REMOTE_COUCHDB) {
            const dbRet = await (replicator as LiveSyncCouchDBReplicator).connectRemoteCouchDBWithSetting(
                settings,
                false,
                true
            );
            if (typeof dbRet === "string") {
                process.stderr.write(`[Verification] Failed to connect to remote CouchDB: ${dbRet}\n`);
                return false;
            }
            milestone = await dbRet.db.get(MILESTONE_DOCID);
        } else if (settings.remoteType === REMOTE_MINIO) {
            milestone = await (replicator as LiveSyncJournalReplicator).client.downloadJson("_00000000-milestone.json");
        }

        if (milestone) {
            const isLocked = !!milestone.locked;
            const isAccepted = !!milestone.accepted_nodes?.includes(replicator.nodeid);
            process.stderr.write(`[Verification] Remote Database: ${isLocked ? "LOCKED" : "UNLOCKED"}\n`);
            process.stderr.write(
                `[Verification] Current Device Node ID (${replicator.nodeid}): ${isAccepted ? "ACCEPTED" : "NOT ACCEPTED"}\n`
            );
            return true;
        } else {
            process.stderr.write("[Verification] Milestone document not found on remote.\n");
            return false;
        }
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[Verification] Failed to fetch milestone document: ${message}\n`);
        return false;
    }
}

export async function runCommand(options: CLIOptions, context: CLICommandContext): Promise<boolean> {
    const { databasePath, core, settingsPath } = context;
    const vaultPath = context.vaultPath || databasePath;

    await core.services.control.activated;
    if (options.command === "daemon") {
        const log = (msg: unknown) => console.error(`[Daemon] ${msg}`);

        // Skip the config mismatch dialog — the daemon cannot resolve it interactively
        // and the default "Dismiss" action would block replication. The daemon should
        // accept whatever configuration the remote has.
        await core.services.setting.applyPartial({ disableCheckingConfigMismatch: true }, true);

        // 1. Replicate CouchDB → local PouchDB so the mirror scan has content to work with.
        log("Replicating from CouchDB...");
        const replResult = await core.services.replication.replicate(true);
        if (!replResult) {
            console.error("[Daemon] Initial CouchDB replication failed, cannot continue");
            return false;
        }
        log("CouchDB replication complete");

        // 2. Mirror scan to reconcile PouchDB ↔ local filesystem.
        const errorManager = new UnresolvedErrorManager(core.services.appLifecycle);
        log("Running mirror scan...");
        const scanOk = await performFullScan(core, log, errorManager, false, true);
        if (!scanOk) {
            console.error("[Daemon] Mirror scan failed, cannot continue");
            return false;
        }
        log("Mirror scan complete");

        // 3. Re-enable sync.
        const restoreSyncSettings = async () => {
            await core.services.setting.applyPartial(
                {
                    ...context.originalSyncSettings,
                    suspendFileWatching: false,
                },
                true
            );
            // applySettings fires the full lifecycle: onSuspending → onResumed.
            // ModuleReplicatorCouchDB starts continuous replication on onResumed
            // via fireAndForget.
            await core.services.control.applySettings();
            // Lifecycle events (onSuspending) may re-enable suspension flags.
            // Clear them explicitly after the lifecycle completes. applyPartial
            // with true is a direct store write — it does not re-trigger lifecycle.
            await core.services.setting.applyPartial(
                {
                    suspendFileWatching: false,
                    suspendParseReplicationResult: false,
                },
                true
            );
        };
        if (options.interval) {
            log(`Polling mode: syncing every ${options.interval}s`);
            await restoreSyncSettings();
            const baseIntervalMs = options.interval * 1000;
            let currentIntervalMs = baseIntervalMs;
            let consecutiveFailures = 0;
            const maxIntervalMs = 5 * 60 * 1000; // 5 minutes cap

            const poll = async () => {
                try {
                    await core.services.replication.replicate(true);
                    if (consecutiveFailures > 0) {
                        consecutiveFailures--;
                        currentIntervalMs = Math.max(currentIntervalMs / 2, baseIntervalMs);
                        log(`Replication recovered`);
                    }
                } catch (err) {
                    consecutiveFailures++;
                    currentIntervalMs = Math.min(baseIntervalMs * Math.pow(2, consecutiveFailures), maxIntervalMs);
                    console.error(`[Daemon] Poll error (${consecutiveFailures} consecutive):`, err);
                    if (consecutiveFailures >= 5) {
                        console.error(
                            `[Daemon] Warning: ${consecutiveFailures} consecutive failures, backing off to ${Math.round(currentIntervalMs / 1000)}s`
                        );
                    }
                }
                pollTimer = compatGlobal.setTimeout(() => {
                    void poll();
                }, currentIntervalMs);
            };
            let pollTimer = compatGlobal.setTimeout(() => {
                void poll();
            }, currentIntervalMs);
            core.services.appLifecycle.onUnload.addHandler(async () => {
                compatGlobal.clearTimeout(pollTimer);
                return true;
            });
        } else {
            log("LiveSync mode: restoring sync settings and starting _changes feed");
            await restoreSyncSettings();
            // The applySettings() lifecycle fires onResumed → ModuleReplicatorCouchDB which
            // starts continuous replication via fireAndForget(openReplication). Don't call
            // openReplication directly — it races with the handler and causes dedup/termination.
            log("LiveSync active");
            const currentSettings = core.services.setting.currentSettings();
            if (!currentSettings.liveSync && !currentSettings.syncOnStart) {
                console.error(
                    "[Daemon] Warning: liveSync and syncOnStart are both disabled in settings. " +
                        "No sync will occur. Set liveSync=true in your settings file for continuous sync, " +
                        "or use --interval for polling mode."
                );
            }
        }

        return true;
    }

    if (options.command === "sync") {
        console.log("[Command] sync");
        const result = await core.services.replication.replicate(true);
        if (!result) {
            // TODO: Standardise the logic for identifying the cause of replication
            // failure so that every reason (locked DB, version mismatch, network
            // error, etc.) is surfaced with a CLI-specific actionable message.
            const replicator = core.services.replicator.getActiveReplicator();
            if (replicator?.remoteLockedAndDeviceNotAccepted) {
                console.error(
                    `[Error] The remote database is locked and this device is not yet accepted.\n` +
                        `[Error] Please unlock the database from the Obsidian plugin and retry.`
                );
            }
        }
        return !!result;
    }

    if (options.command === "p2p-peers") {
        if (options.commandArgs.length < 1) {
            throw new Error("p2p-peers requires one argument: <timeout>");
        }
        const timeoutSec = parseTimeoutSeconds(options.commandArgs[0], "p2p-peers");
        console.error(`[Command] p2p-peers timeout=${timeoutSec}s`);
        const peers = await collectPeers(core, timeoutSec);
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
        const peer = await syncWithPeer(core, peerToken, timeoutSec);
        console.error(`[Done] P2P sync completed with ${peer.name} (${peer.peerId})`);
        return true;
    }

    if (options.command === "p2p-host") {
        console.error("[Command] p2p-host");
        await openP2PHost(core);
        console.error("[Ready] P2P host is running. Press Ctrl+C to stop.");
        await new Promise(() => {});
        return true;
    }

    if (options.command === "push") {
        if (options.commandArgs.length < 2) {
            throw new Error("push requires two arguments: <src> <dst>");
        }
        const sourcePath = path.resolve(options.commandArgs[0]);
        const destinationDatabasePath = toDatabaseRelativePath(options.commandArgs[1], vaultPath);
        const sourceData = await fs.readFile(sourcePath);
        const sourceStat = await fs.stat(sourcePath);
        console.log(`[Command] push ${sourcePath} -> ${destinationDatabasePath}`);

        await core.serviceModules.storageAccess.writeFileAuto(destinationDatabasePath, toArrayBuffer(sourceData), {
            mtime: Math.floor(sourceStat.mtimeMs),
            ctime: Math.floor(sourceStat.ctimeMs),
        });
        const destinationPathWithPrefix = destinationDatabasePath as FilePathWithPrefix;
        const stored = await core.serviceModules.fileHandler.storeFileToDB(destinationPathWithPrefix, true);
        return stored;
    }

    if (options.command === "pull") {
        if (options.commandArgs.length < 2) {
            throw new Error("pull requires two arguments: <src> <dst>");
        }
        const sourceDatabasePath = toDatabaseRelativePath(options.commandArgs[0], vaultPath);
        const destinationPath = path.resolve(options.commandArgs[1]);
        console.log(`[Command] pull ${sourceDatabasePath} -> ${destinationPath}`);

        const sourcePathWithPrefix = sourceDatabasePath as FilePathWithPrefix;
        const restored = await core.serviceModules.fileHandler.dbToStorage(sourcePathWithPrefix, null, true);
        if (!restored) {
            return false;
        }
        const data = await core.serviceModules.storageAccess.readFileAuto(sourceDatabasePath);
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
        const sourceDatabasePath = toDatabaseRelativePath(options.commandArgs[0], vaultPath);
        const destinationPath = path.resolve(options.commandArgs[1]);
        const rev = options.commandArgs[2].trim();
        if (!rev) {
            throw new Error("pull-rev requires a non-empty revision");
        }
        console.log(`[Command] pull-rev ${sourceDatabasePath}@${rev} -> ${destinationPath}`);

        const source = await core.serviceModules.databaseFileAccess.fetch(
            sourceDatabasePath as FilePathWithPrefix,
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
        await core.services.setting.applyExternalSettings(nextSettings, true);
        await core.services.control.applySettings();
        return true;
    }

    if (options.command === "put") {
        if (options.commandArgs.length < 1) {
            throw new Error("put requires one argument: <dst>");
        }
        const destinationDatabasePath = toDatabaseRelativePath(options.commandArgs[0], vaultPath);
        const content = await readStdinAsUtf8();
        console.log(`[Command] put stdin -> ${destinationDatabasePath}`);
        return await core.serviceModules.databaseFileAccess.storeContent(
            destinationDatabasePath as FilePathWithPrefix,
            content
        );
    }

    if (options.command === "cat") {
        if (options.commandArgs.length < 1) {
            throw new Error("cat requires one argument: <src>");
        }
        const sourceDatabasePath = toDatabaseRelativePath(options.commandArgs[0], vaultPath);
        console.error(`[Command] cat ${sourceDatabasePath}`);
        const source = await core.serviceModules.databaseFileAccess.fetch(
            sourceDatabasePath as FilePathWithPrefix,
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
        const sourceDatabasePath = toDatabaseRelativePath(options.commandArgs[0], vaultPath);
        const rev = options.commandArgs[1].trim();
        if (!rev) {
            throw new Error("cat-rev requires a non-empty revision");
        }
        console.error(`[Command] cat-rev ${sourceDatabasePath} @ ${rev}`);
        const source = await core.serviceModules.databaseFileAccess.fetch(
            sourceDatabasePath as FilePathWithPrefix,
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
                ? toDatabaseRelativePath(options.commandArgs[0], vaultPath)
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
        } else {
            process.stderr.write("[Info] No documents found in the local database.\n");
        }
        return true;
    }

    if (options.command === "info") {
        if (options.commandArgs.length < 1) {
            throw new Error("info requires one argument: <path>");
        }
        const targetPath = toDatabaseRelativePath(options.commandArgs[0], vaultPath);

        for await (const doc of core.services.database.localDatabase.findAllNormalDocs({ conflicts: true })) {
            if (doc._deleted || doc.deleted) continue;
            const docPath = stripAllPrefixes(doc.path);
            if (docPath !== targetPath) continue;

            const filename = path.basename(docPath);
            const conflictsText = (doc._conflicts?.length ?? 0) > 0 ? doc._conflicts?.join("\n           ") : "N/A";
            const children = "children" in doc ? doc.children : [];
            const rawDoc = await core.services.database.localDatabase.getRaw<EntryDoc>(doc._id, {
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
        const targetPath = toDatabaseRelativePath(options.commandArgs[0], vaultPath);
        console.error(`[Command] rm ${targetPath}`);
        return await core.serviceModules.databaseFileAccess.delete(targetPath as FilePathWithPrefix);
    }

    if (options.command === "resolve") {
        if (options.commandArgs.length < 2) {
            throw new Error("resolve requires two arguments: <path> <revision-to-keep>");
        }
        const targetPath = toDatabaseRelativePath(options.commandArgs[0], vaultPath) as FilePathWithPrefix;
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
            const resolved = await core.services.conflict.resolveByDeletingRevision(targetPath, revision ?? "", "CLI");
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
        return await performFullScan(core, log, errorManager, false, true);
    }

    if (options.command === "remote-add") {
        if (options.commandArgs.length < 2) {
            throw new Error("remote-add requires two arguments: <name> <connstr>");
        }
        const name = options.commandArgs[0].trim();
        const connectionString = options.commandArgs[1].trim();
        if (!name) {
            throw new Error("remote-add requires a non-empty name");
        }
        if (!connectionString) {
            throw new Error("remote-add requires a non-empty connection string");
        }

        const parsed = ConnectionStringParser.parse(connectionString);
        const canonicalUri = ConnectionStringParser.serialize(parsed);
        const id = createRemoteConfigurationId();
        let activated = false;

        await core.services.setting.updateSettings((currentSettings) => {
            currentSettings.remoteConfigurations ||= {};
            currentSettings.remoteConfigurations[id] = {
                id,
                name,
                uri: canonicalUri,
                isEncrypted: false,
            };
            if (!currentSettings.activeConfigurationId) {
                currentSettings.activeConfigurationId = id;
                const applied = activateRemoteConfiguration(currentSettings, id);
                activated = applied !== false;
            }
            return currentSettings;
        }, true);

        if (activated) {
            await core.services.control.applySettings();
        }

        process.stdout.write(`${id}\t${name}\t${redactConnectionString(canonicalUri)}\n`);
        return true;
    }

    if (options.command === "remote-rm") {
        if (options.commandArgs.length < 1) {
            throw new Error("remote-rm requires one argument: <remote-id>");
        }
        const id = options.commandArgs[0].trim();
        if (!id) {
            throw new Error("remote-rm requires a non-empty remote-id");
        }

        const current = core.services.setting.currentSettings();
        if (!current.remoteConfigurations?.[id]) {
            process.stderr.write(`[Info] Remote configuration not found: ${id}\n`);
            return false;
        }

        let switchedActive = false;
        await core.services.setting.updateSettings((currentSettings) => {
            const configs = currentSettings.remoteConfigurations || {};
            delete configs[id];
            currentSettings.remoteConfigurations = configs;

            if (currentSettings.activeConfigurationId === id) {
                const nextActiveId = Object.keys(configs)[0] || "";
                currentSettings.activeConfigurationId = nextActiveId;
                switchedActive = nextActiveId !== "";
                if (nextActiveId !== "") {
                    activateRemoteConfiguration(currentSettings, nextActiveId);
                }
            }

            if (currentSettings.P2P_ActiveRemoteConfigurationId === id) {
                currentSettings.P2P_ActiveRemoteConfigurationId = "";
            }

            return currentSettings;
        }, true);

        if (switchedActive) {
            await core.services.control.applySettings();
        }

        console.error(`[Command] remote-rm ${id}`);
        return true;
    }

    if (options.command === "remote-ls") {
        const settings = core.services.setting.currentSettings();
        const configs = Object.values(settings.remoteConfigurations || {});
        configs.sort((a, b) => a.name.localeCompare(b.name));

        if (configs.length === 0) {
            process.stderr.write("[Info] No remote configurations found.\n");
            return true;
        }

        const lines = configs.map((config) => {
            const status = config.id === settings.activeConfigurationId ? "active" : "inactive";
            return `${config.id}\t${config.name}\t${status}\t${redactConnectionString(config.uri)}`;
        });
        process.stdout.write(lines.join("\n") + "\n");
        return true;
    }

    if (options.command === "remote-export") {
        if (options.commandArgs.length < 1) {
            throw new Error("remote-export requires one argument: <remote-id>");
        }
        const id = options.commandArgs[0].trim();
        if (!id) {
            throw new Error("remote-export requires a non-empty remote-id");
        }

        const config = core.services.setting.currentSettings().remoteConfigurations?.[id];
        if (!config) {
            process.stderr.write(`[Info] Remote configuration not found: ${id}\n`);
            return false;
        }

        process.stdout.write(`${config.uri}\n`);
        return true;
    }

    if (options.command === "remote-set") {
        if (options.commandArgs.length < 2) {
            throw new Error("remote-set requires two arguments: <remote-id> <connstr>");
        }
        const id = options.commandArgs[0].trim();
        const connectionString = options.commandArgs[1].trim();
        if (!id) {
            throw new Error("remote-set requires a non-empty remote-id");
        }
        if (!connectionString) {
            throw new Error("remote-set requires a non-empty connection string");
        }

        const parsed = ConnectionStringParser.parse(connectionString);
        const canonicalUri = ConnectionStringParser.serialize(parsed);
        let switchedActive = false;

        await core.services.setting.updateSettings((currentSettings) => {
            const config = currentSettings.remoteConfigurations?.[id];
            if (!config) {
                return currentSettings;
            }
            config.uri = canonicalUri;

            if (currentSettings.activeConfigurationId === id) {
                const activated = activateRemoteConfiguration(currentSettings, id);
                switchedActive = activated !== false;
                if (activated) {
                    return activated;
                }
            }
            return currentSettings;
        }, true);

        const updated = core.services.setting.currentSettings().remoteConfigurations?.[id];
        if (!updated) {
            process.stderr.write(`[Info] Remote configuration not found: ${id}\n`);
            return false;
        }

        if (switchedActive) {
            await core.services.control.applySettings();
        }

        console.error(`[Command] remote-set ${id}`);
        return true;
    }
    if (options.command === "remote-activate") {
        if (options.commandArgs.length < 1) {
            throw new Error("remote-activate requires one argument: <remote-id>");
        }
        const id = options.commandArgs[0].trim();
        if (!id) {
            throw new Error("remote-activate requires a non-empty remote-id");
        }

        let switched = false;
        await core.services.setting.updateSettings((currentSettings) => {
            const activated = activateRemoteConfiguration(currentSettings, id);
            if (activated) {
                switched = true;
                return activated;
            }
            return currentSettings;
        }, true);

        if (!switched) {
            process.stderr.write(`[Info] Failed to activate remote configuration: ${id}\n`);
            return false;
        }

        await core.services.control.applySettings();
        console.error(`[Command] remote-activate ${id}`);
        return true;
    }

    if (options.command === "mark-resolved") {
        const id = options.commandArgs[0]?.trim();
        if (id) {
            let switched = false;
            await core.services.setting.updateSettings((currentSettings) => {
                const activated = activateRemoteConfiguration(currentSettings, id);
                if (activated) {
                    switched = true;
                    return activated;
                }
                return currentSettings;
            }, false);

            if (!switched) {
                process.stderr.write(`[Info] Failed to temporarily activate remote configuration: ${id}\n`);
                return false;
            }

            await core.services.control.applySettings();
        }

        console.error(`[Command] mark-resolved${id ? ` ${id}` : ""}`);
        await core.services.replication.markResolved();
        const settings = core.services.setting.currentSettings();
        await verifyRemoteState(core, settings);
        return true;
    }

    if (options.command === "unlock-remote") {
        const id = options.commandArgs[0]?.trim();
        if (id) {
            let switched = false;
            await core.services.setting.updateSettings((currentSettings) => {
                const activated = activateRemoteConfiguration(currentSettings, id);
                if (activated) {
                    switched = true;
                    return activated;
                }
                return currentSettings;
            }, false);

            if (!switched) {
                process.stderr.write(`[Info] Failed to temporarily activate remote configuration: ${id}\n`);
                return false;
            }

            await core.services.control.applySettings();
        }

        console.error(`[Command] unlock-remote${id ? ` ${id}` : ""}`);
        await core.services.replication.markUnlocked();
        const settings = core.services.setting.currentSettings();
        await verifyRemoteState(core, settings);
        return true;
    }

    if (options.command === "lock-remote") {
        const id = options.commandArgs[0]?.trim();
        if (id) {
            let switched = false;
            await core.services.setting.updateSettings((currentSettings) => {
                const activated = activateRemoteConfiguration(currentSettings, id);
                if (activated) {
                    switched = true;
                    return activated;
                }
                return currentSettings;
            }, false);

            if (!switched) {
                process.stderr.write(`[Info] Failed to temporarily activate remote configuration: ${id}\n`);
                return false;
            }

            await core.services.control.applySettings();
        }

        console.error(`[Command] lock-remote${id ? ` ${id}` : ""}`);
        await core.services.replication.markLocked();
        const settings = core.services.setting.currentSettings();
        await verifyRemoteState(core, settings);
        return true;
    }

    if (options.command === "remote-status") {
        const id = options.commandArgs[0]?.trim();
        if (id) {
            let switched = false;
            await core.services.setting.updateSettings((currentSettings) => {
                const activated = activateRemoteConfiguration(currentSettings, id);
                if (activated) {
                    switched = true;
                    return activated;
                }
                return currentSettings;
            }, false);

            if (!switched) {
                process.stderr.write(`[Info] Failed to temporarily activate remote configuration: ${id}\n`);
                return false;
            }

            await core.services.control.applySettings();
        }

        console.error(`[Command] remote-status${id ? ` ${id}` : ""}`);
        const replicator = core.services.replicator.getActiveReplicator();
        if (!replicator) {
            process.stderr.write("[Error] No active replicator found\n");
            return false;
        }
        const settings = core.services.setting.currentSettings();
        const status = await replicator.getRemoteStatus(settings);
        if (status === false) {
            process.stderr.write("[Error] Failed to fetch remote status\n");
            return false;
        }
        process.stdout.write(JSON.stringify(status, null, 2) + "\n");
        return true;
    }

    throw new Error(`Unsupported command: ${options.command}`);
}
