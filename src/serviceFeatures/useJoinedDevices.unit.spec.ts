import { describe, expect, it, vi } from "vitest";
import { UICommandRegistry } from "@vrtmrz/livesync-commonlib/ui-commands";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";
import { REMOTE_COUCHDB } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { JoinedDevicesSnapshot } from "@vrtmrz/livesync-commonlib/replication";
import type { JoinedDevicesDialogOptions } from "./joinedDevicesDialogTypes";
vi.mock("@/modules/services/LiveSyncUI/dialogues/JoinedDevicesDialog.svelte", () => ({ default: {} }));
vi.mock("@/common/translation", () => ({
    $msg: (message: string, values: Record<string, string> = {}) =>
        message.replace(/\$\{([^}]+)\}/g, (placeholder, key: string) => values[key] ?? placeholder),
}));
import { useJoinedDevicesFeature } from "./useJoinedDevices";
import { OPEN_JOINED_DEVICES } from "./joinedDevicesCommand";

function fixture() {
    const settings = {
        ...createNewVaultSettings(),
        remoteType: REMOTE_COUCHDB,
        couchDB_URI: "https://example.test",
        couchDB_DBNAME: "vault",
    };
    const initialise: Array<() => Promise<boolean>> = [];
    const unload: Array<() => Promise<boolean>> = [];
    const before: Array<() => Promise<boolean>> = [];
    const stopBefore = vi.fn();
    const commands = new UICommandRegistry();
    const read = vi.fn<() => Promise<JoinedDevicesSnapshot>>(async () => ({
        milestonePresent: true,
        locked: false,
        cleaned: false,
        devices: [{ id: "other", accepted: true, pluginVersion: "2.0.0" }],
    }));
    const forget = vi.fn(async (_id: string) => "forgotten" as const);
    const dispose = vi.fn(async () => {});
    const createResource = vi.fn(async () => ({ read, forget, dispose }));
    let close!: () => void;
    const dialog = vi.fn(
        (_component: unknown, _options: JoinedDevicesDialogOptions) =>
            new Promise<void>((resolve) => {
                close = resolve;
            })
    );
    const notices = { setItem: vi.fn(), removeItem: vi.fn(), finish: vi.fn(), hide: vi.fn() };
    const palette: Array<{ id: string; checkCallback: (checking: boolean) => boolean }> = [];
    const database = { localDatabase: { get: vi.fn(async () => ({ nodeid: "self" })) } };
    const host = {
        services: {
            API: {
                getPluginVersion: () => "1.0.0",
                getAppVersion: () => "1.9.0",
                getPlatform: () => "desktop",
                addCommand: (command: (typeof palette)[number]) => palette.push(command),
            },
            UI: { commands, dialogManager: { open: dialog } },
            setting: { currentSettings: () => settings },
            database: { isDatabaseReady: () => true, localDatabase: database },
            replicator: { createRemoteResource: createResource },
            replication: {
                onBeforeReplicate: {
                    addHandler: (handler: (typeof before)[number]) => {
                        before.push(handler);
                        return stopBefore;
                    },
                },
            },
            appLifecycle: {
                onInitialise: { addHandler: (handler: (typeof initialise)[number]) => initialise.push(handler) },
                onUnload: { addHandler: (handler: (typeof unload)[number]) => unload.push(handler) },
            },
        },
        serviceModules: {},
    } as unknown as Parameters<typeof useJoinedDevicesFeature>[0];
    useJoinedDevicesFeature(host, notices as unknown as Parameters<typeof useJoinedDevicesFeature>[1]);
    return {
        settings,
        initialise,
        unload,
        before,
        stopBefore,
        commands,
        read,
        forget,
        dispose,
        createResource,
        dialog,
        notices,
        palette,
        database,
        close: () => close(),
    };
}

async function open(data: ReturnType<typeof fixture>) {
    const pending = data.commands.invoke(OPEN_JOINED_DEVICES, undefined);
    const options = data.dialog.mock.calls[0][1];
    return { options, pending };
}

describe("joined devices service feature", () => {
    it("opens one dialogue through the command and disposes each completed read", async () => {
        const data = fixture();
        const { options, pending } = await open(data);
        expect(await data.commands.invoke(OPEN_JOINED_DEVICES, undefined)).toEqual({
            status: "handled",
            value: "already-open",
        });
        expect((await options.refresh()).devices[0]).toMatchObject({ id: "self", self: true });
        expect(data.dispose).toHaveBeenCalledTimes(1);
        data.close();
        expect(await pending).toEqual({ status: "handled", value: "closed" });
        await expect(options.refresh()).rejects.toThrow();
    });
    it("prevents self removal and fences an old dialogue after a remote switch", async () => {
        const data = fixture();
        const { options, pending } = await open(data);
        await expect(options.forget("self")).rejects.toThrow();
        data.settings.couchDB_DBNAME = "new-vault";
        await expect(options.forget("other")).rejects.toThrow();
        expect(data.forget).not.toHaveBeenCalled();
        expect(data.createResource).not.toHaveBeenCalled();
        data.close();
        await pending;
    });
    it("discards a stale read, releases the resource, and emits no stale Notice", async () => {
        const data = fixture();
        let resolve!: (value: JoinedDevicesSnapshot) => void;
        data.read.mockReturnValueOnce(
            new Promise((done) => {
                resolve = done;
            })
        );
        const { options, pending } = await open(data);
        const reading = options.refresh();
        await vi.waitFor(() => expect(data.read).toHaveBeenCalled());
        data.settings.couchDB_DBNAME = "new-vault";
        resolve({ milestonePresent: true, locked: false, cleaned: false, devices: [] });
        await expect(reading).rejects.toThrow();
        expect(data.dispose).toHaveBeenCalledOnce();
        expect(data.notices.setItem).not.toHaveBeenCalled();
        data.close();
        await pending;
    });
    it.each(["dialogue cancellation", "remote switch", "unload"] as const)(
        "does not send a pending forget operation after %s",
        async (invalidation) => {
            const data = fixture();
            const resource = { read: data.read, forget: data.forget, dispose: data.dispose };
            let resolve!: (value: typeof resource) => void;
            data.createResource.mockReturnValueOnce(
                new Promise((done) => {
                    resolve = done;
                })
            );
            const { options, pending } = await open(data);
            const forgetting = options.forget("other");
            const rejected = expect(forgetting).rejects.toThrow();
            await vi.waitFor(() => expect(data.createResource).toHaveBeenCalledOnce());

            if (invalidation === "dialogue cancellation") options.cancel();
            if (invalidation === "remote switch") data.settings.couchDB_DBNAME = "new-vault";
            if (invalidation === "unload") for (const unload of data.unload) await unload();
            resolve(resource);

            await rejected;
            expect(data.forget).not.toHaveBeenCalled();
            expect(data.dispose).toHaveBeenCalledOnce();
            data.close();
            await pending;
        }
    );
    it("discards a completed forget result after the dialogue closes and releases its resource", async () => {
        const data = fixture();
        let resolve!: (value: "forgotten") => void;
        data.forget.mockReturnValueOnce(
            new Promise((done) => {
                resolve = done;
            })
        );
        const { options, pending } = await open(data);
        const forgetting = options.forget("other");
        const rejected = expect(forgetting).rejects.toThrow();
        await vi.waitFor(() => expect(data.forget).toHaveBeenCalledWith("other"));
        data.close();
        await pending;
        resolve("forgotten");
        await rejected;
        expect(data.dispose).toHaveBeenCalledOnce();
    });
    it("propagates a failed forget operation after releasing its resource", async () => {
        const data = fixture();
        const failure = new Error("conditional write failed");
        data.forget.mockRejectedValueOnce(failure);
        const { options, pending } = await open(data);
        await expect(options.forget("other")).rejects.toBe(failure);
        expect(data.dispose).toHaveBeenCalledOnce();
        data.close();
        await pending;
    });
    it("shares one review action across newer and older device versions", async () => {
        const data = fixture();
        data.read.mockResolvedValue({
            milestonePresent: true,
            locked: false,
            cleaned: false,
            devices: [
                { id: "newer-a", accepted: true, pluginVersion: "2.0.0" },
                { id: "newer-b", accepted: true, pluginVersion: "3.0.0" },
                { id: "older-a", accepted: true, pluginVersion: "0.9.0" },
                { id: "older-b", accepted: true, pluginVersion: "0.8.0" },
                { id: "older-duplicate", accepted: true, pluginVersion: "0.8.0" },
            ],
        });
        const { options, pending } = await open(data);
        await options.refresh();
        const items = data.notices.setItem.mock.calls.map(([, , item]) => item);
        expect(items.filter((item) => item.action)).toHaveLength(1);
        const messages = items.map((item) => item.message).join("\n");
        expect(messages).toContain("Self-hosted LiveSync");
        expect(messages).toMatch(/Newer.*2\.0\.0, 3\.0\.0/);
        expect(messages).toMatch(/Older.*0\.8\.0, 0\.9\.0/);
        expect(messages.match(/0\.8\.0/g)).toHaveLength(1);
        expect(messages.match(/Reviewing and aligning/g)).toHaveLength(1);
        expect(items[items.length - 1]?.action?.label).toBe("Review devices");
        expect(data.notices.finish).toHaveBeenCalledExactlyOnceWith("joined-device-versions", {
            durationMs: 15000,
        });
        data.close();
        await pending;
    });
    it("keeps the shared action last when another version direction arrives", async () => {
        const data = fixture();
        const visible = new Map<string, { message: string; action?: unknown }>();
        data.notices.setItem.mockImplementation((_group, key, item) => visible.set(key, item));
        data.notices.removeItem.mockImplementation((_group, key) => visible.delete(key));
        const { options, pending } = await open(data);
        await options.refresh();
        expect([...visible.keys()]).toEqual(["newer", "review"]);

        data.read.mockResolvedValue({
            milestonePresent: true,
            locked: false,
            cleaned: false,
            devices: [
                { id: "other", accepted: true, pluginVersion: "2.0.0" },
                { id: "older", accepted: true, pluginVersion: "0.9.0" },
            ],
        });
        await options.refresh();
        expect([...visible.keys()]).toEqual(["newer", "older", "review"]);
        expect([...visible.values()].filter((item) => item.action)).toHaveLength(1);

        visible.clear();
        data.read.mockResolvedValue({
            milestonePresent: true,
            locked: false,
            cleaned: false,
            devices: [
                { id: "other", accepted: true, pluginVersion: "2.0.0" },
                { id: "older", accepted: true, pluginVersion: "0.8.0" },
            ],
        });
        await options.refresh();
        expect([...visible.keys()]).toEqual(["older", "review"]);
        expect([...visible.values()].filter((item) => item.action)).toHaveLength(1);
        data.close();
        await pending;
    });
    it("does not show a review action when no different version is reported", async () => {
        const data = fixture();
        data.read.mockResolvedValue({
            milestonePresent: true,
            locked: false,
            cleaned: false,
            devices: [{ id: "other", accepted: true, pluginVersion: "1.0.0" }],
        });
        const { options, pending } = await open(data);
        await options.refresh();
        expect(data.notices.setItem).not.toHaveBeenCalled();
        expect(data.notices.removeItem).not.toHaveBeenCalled();
        expect(data.notices.finish).not.toHaveBeenCalled();
        data.close();
        await pending;
    });
    it("deduplicates advisory Notices and fences their actions after configuration changes", async () => {
        const data = fixture();
        const { options, pending } = await open(data);
        await options.refresh();
        await options.refresh();
        expect(data.notices.setItem).toHaveBeenCalledTimes(2);
        const actions = data.notices.setItem.mock.calls.map(([, , item]) => item.action).filter(Boolean);
        expect(actions).toHaveLength(1);
        const action = actions[0];
        data.close();
        await pending;
        data.settings.couchDB_DBNAME = "new-vault";
        action.onSelect();
        expect(data.dialog).toHaveBeenCalledTimes(1);
    });
    it("keeps inspection failures out of the replication result and unregisters on unload", async () => {
        const data = fixture();
        data.read.mockRejectedValue(new Error("unavailable"));
        expect(await data.before[0]()).toBe(true);
        await vi.waitFor(() => expect(data.dispose).toHaveBeenCalledOnce());
        expect(await data.before[0]()).toBe(true);
        expect(data.read).toHaveBeenCalledTimes(1);
        for (const unload of data.unload) await unload();
        expect(await data.commands.invoke(OPEN_JOINED_DEVICES, undefined)).toEqual({ status: "unavailable" });
        expect(data.stopBefore).toHaveBeenCalledOnce();
        expect(data.notices.hide).toHaveBeenCalled();
    });
    it("uses the same UI command from the command palette", async () => {
        const data = fixture();
        for (const initialise of data.initialise) await initialise();
        expect(data.palette[0].checkCallback(true)).toBe(true);
        expect(data.dialog).not.toHaveBeenCalled();
        data.palette[0].checkCallback(false);
        expect(data.dialog).toHaveBeenCalledOnce();
        data.close();
    });
});
