import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import {
    NODEINFO_DOCID,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    type EntryNodeInfo,
    type RemoteDBSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { REMOTE_RESOURCE_KINDS, type JoinedDevicesSnapshot } from "@vrtmrz/livesync-commonlib/replication";
import type { ObsidianNoticeGroups } from "@/modules/services/ObsidianNoticeGroups";
import JoinedDevicesDialog from "@/modules/services/LiveSyncUI/dialogues/JoinedDevicesDialog.svelte";
import {
    getCouchDBReplicatorConfigurationIdentity,
    getObjectStorageReplicatorConfigurationIdentity,
} from "@/common/replicatorConfigurationIdentity";
import { $msg } from "@/common/translation";
import { OPEN_JOINED_DEVICES } from "./joinedDevicesCommand";
import { differentDeviceVersions, joinedDevicesView } from "./joinedDevices";
import type { JoinedDevicesDialogOptions } from "./joinedDevicesDialogTypes";

type JoinedDevicesHost = NecessaryServices<
    "API" | "UI" | "setting" | "database" | "replicator" | "replication" | "appLifecycle",
    never
>;
const noticeGroup = "joined-device-versions";

function remoteIdentity(settings: RemoteDBSettings): string | undefined {
    if (settings.remoteType === REMOTE_COUCHDB && settings.couchDB_URI && settings.couchDB_DBNAME) {
        return getCouchDBReplicatorConfigurationIdentity(settings);
    }
    if (settings.remoteType === REMOTE_MINIO && settings.endpoint && settings.bucket) {
        return getObjectStorageReplicatorConfigurationIdentity(settings);
    }
    return undefined;
}

/** Own the dialogue, advisory Notices, and their per-session state for one host. */
export function useJoinedDevicesFeature(host: JoinedDevicesHost, notices: ObsidianNoticeGroups): void {
    const { services } = host;
    let disposed = false;
    let active: AbortController | undefined;
    let checking = false;
    let lastCheck: { identity: string; at: number } | undefined;
    const notified = new Map<string, Set<string>>();
    const available = () =>
        !disposed &&
        services.database.isDatabaseReady() &&
        remoteIdentity(services.setting.currentSettings()) !== undefined;

    const notify = (snapshot: JoinedDevicesSnapshot, ownId: string, identity: string) => {
        if (disposed || identity !== remoteIdentity(services.setting.currentSettings())) return;
        const version = services.API.getPluginVersion();
        const differences = differentDeviceVersions(snapshot, ownId, version);
        const seen = notified.get(identity) ?? new Set<string>();
        notified.set(identity, seen);
        let updated = false;
        for (const direction of ["newer", "older"] as const) {
            const versions = differences[direction];
            if (versions.length === 0) continue;
            const key = JSON.stringify([version, direction, versions]);
            if (seen.has(key)) continue;
            seen.add(key);
            notices.setItem(noticeGroup, direction, {
                message:
                    direction === "newer"
                        ? $msg("Newer Self-hosted LiveSync versions detected: ${versions}.", {
                              versions: versions.join(", "),
                          })
                        : $msg("Older Self-hosted LiveSync versions detected: ${versions}.", {
                              versions: versions.join(", "),
                          }),
            });
            updated = true;
        }
        if (!updated) return;
        notices.removeItem(noticeGroup, "review");
        notices.setItem(noticeGroup, "review", {
            message: $msg("Reviewing and aligning Self-hosted LiveSync versions across devices is recommended."),
            action: {
                label: $msg("Review devices"),
                onSelect: () => {
                    if (!disposed && identity === remoteIdentity(services.setting.currentSettings())) {
                        void services.UI.commands.invoke(OPEN_JOINED_DEVICES, undefined);
                    }
                },
            },
        });
        notices.finish(noticeGroup, { durationMs: 15000 });
    };

    const createOperations = (controller: AbortController): JoinedDevicesDialogOptions => {
        const settings = { ...services.setting.currentSettings() };
        const identity = remoteIdentity(settings);
        const database = services.database.localDatabase;
        const assertCurrent = () => {
            if (
                disposed ||
                controller.signal.aborted ||
                !identity ||
                identity !== remoteIdentity(services.setting.currentSettings()) ||
                !services.database.isDatabaseReady() ||
                services.database.localDatabase !== database
            ) {
                throw new Error("Joined devices are no longer available for this dialogue");
            }
        };
        const ownId = async () => {
            assertCurrent();
            const info = await database.localDatabase.get<EntryNodeInfo>(NODEINFO_DOCID);
            assertCurrent();
            if (typeof info.nodeid !== "string" || !info.nodeid) throw new Error("Device identity is unavailable");
            return info.nodeid;
        };
        return {
            refresh: async () => {
                const id = await ownId();
                const resource = await services.replicator.createRemoteResource(
                    REMOTE_RESOURCE_KINDS.JOINED_DEVICES,
                    settings
                );
                if (!resource) throw new Error("Joined devices are unavailable");
                try {
                    assertCurrent();
                    const snapshot = await resource.read();
                    assertCurrent();
                    notify(snapshot, id, identity!);
                    return joinedDevicesView(snapshot, {
                        id,
                        platform: services.API.getPlatform(),
                        pluginVersion: services.API.getPluginVersion(),
                        appVersion: services.API.getAppVersion(),
                    });
                } finally {
                    await resource.dispose();
                }
            },
            forget: async (id) => {
                if (id === (await ownId())) throw new Error("This device cannot be forgotten");
                const resource = await services.replicator.createRemoteResource(
                    REMOTE_RESOURCE_KINDS.JOINED_DEVICES,
                    settings
                );
                if (!resource) throw new Error("Joined devices are unavailable");
                try {
                    assertCurrent();
                    const result = await resource.forget(id);
                    assertCurrent();
                    return result;
                } finally {
                    await resource.dispose();
                }
            },
            cancel: () => controller.abort(),
        };
    };

    const unregister = services.UI.commands.register(OPEN_JOINED_DEVICES, async () => {
        if (!available()) return "unavailable";
        if (active) return "already-open";
        const controller = new AbortController();
        active = controller;
        try {
            await services.UI.dialogManager.open<"close", JoinedDevicesDialogOptions>(
                JoinedDevicesDialog,
                createOperations(controller)
            );
        } catch {
            // The host may close its dialogues during unload.
        } finally {
            controller.abort();
            if (active === controller) active = undefined;
        }
        return "closed";
    });

    const checkVersions = () => {
        if (!available() || checking) return;
        const identity = remoteIdentity(services.setting.currentSettings())!;
        if (lastCheck?.identity === identity && Date.now() - lastCheck.at < 60000) return;
        lastCheck = { identity, at: Date.now() };
        checking = true;
        const controller = new AbortController();
        void Promise.resolve()
            .then(() => createOperations(controller).refresh())
            .catch(() => {
                // Advisory inspection never changes the outcome of synchronisation.
            })
            .finally(() => {
                controller.abort();
                checking = false;
            });
    };
    const stopBeforeReplicate = services.replication.onBeforeReplicate.addHandler(() => {
        checkVersions();
        return Promise.resolve(true);
    });
    services.appLifecycle.onInitialise.addHandler(() => {
        services.API.addCommand({
            id: "joined-devices",
            name: $msg("Review devices"),
            icon: "monitor-smartphone",
            checkCallback: (checking) => {
                if (!available()) return false;
                if (!checking) void services.UI.commands.invoke(OPEN_JOINED_DEVICES, undefined);
                return true;
            },
        });
        return Promise.resolve(true);
    });
    services.appLifecycle.onUnload.addHandler(() => {
        disposed = true;
        active?.abort();
        unregister();
        stopBeforeReplicate();
        notices.hide(noticeGroup);
        notified.clear();
        return Promise.resolve(true);
    });
}
