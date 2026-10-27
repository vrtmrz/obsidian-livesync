import { describe, expect, it } from "vitest";
import { comparePluginVersions, differentDeviceVersions, joinedDevicesView } from "./joinedDevices";
import type { JoinedDevicesSnapshot } from "@vrtmrz/livesync-commonlib/replication";

const empty: JoinedDevicesSnapshot = { milestonePresent: false, locked: false, cleaned: false, devices: [] };

describe("joined device presentation", () => {
    it("always shows this device first, including before its remote record exists", () => {
        const view = joinedDevicesView(
            { ...empty, devices: [{ id: "another", accepted: true }] },
            { id: "self", platform: "ios", pluginVersion: "1.0.39" }
        );
        expect(view.devices.map((device) => device.id)).toEqual(["self", "another"]);
        expect(view.devices[0]).toMatchObject({ self: true, accepted: false, lockedOut: false, platform: "ios" });
    });
    it("keeps the remote last-recorded date and acceptance while showing current local versions", () => {
        const view = joinedDevicesView(
            {
                ...empty,
                milestonePresent: true,
                locked: true,
                devices: [
                    { id: "other", accepted: true },
                    { id: "self", accepted: false, lastConnected: 123, pluginVersion: "1.0.0" },
                ],
            },
            { id: "self", pluginVersion: "1.1.0" }
        );
        expect(view.devices[0]).toMatchObject({
            self: true,
            lockedOut: true,
            lastConnected: 123,
            pluginVersion: "1.1.0",
        });
        expect(view.devices[1].lockedOut).toBe(false);
    });
});

describe("version advisories", () => {
    it.each([
        ["1.10.0", "1.9.9", 1],
        ["1.0.0", "1.0.0-rc.1", 1],
        ["1.0.0-beta.2", "1.0.0-beta.10", -1],
        ["1.0.0-1", "1.0.0-alpha", -1],
        ["1.0.0-alpha", "1.0.0-alpha.1", -1],
        ["1.0.0+first", "1.0.0+second", 0],
        ["99999999999999999.0.0", "99999999999999998.0.0", 1],
    ])("compares %s with %s", (a, b, result) => expect(comparePluginVersions(a, b)).toBe(result));
    it.each(["", "development", "1.0", "01.0.0", "1.0.0-01", "v1.0.0"])(
        "does not order unknown version %s",
        (version) => {
            expect(comparePluginVersions(version, "1.0.0")).toBeUndefined();
            expect(comparePluginVersions("1.0.0", version)).toBeUndefined();
        }
    );
    it("excludes this device and unknown versions, and deduplicates versions", () => {
        const snapshot = {
            ...empty,
            devices: [
                { id: "self", accepted: false, pluginVersion: "9.0.0" },
                { id: "a", accepted: true, pluginVersion: "2.0.0" },
                { id: "b", accepted: false, pluginVersion: "2.0.0" },
                { id: "c", accepted: false, pluginVersion: "0.9.0" },
                { id: "d", accepted: true, pluginVersion: "custom" },
            ],
        };
        expect(differentDeviceVersions(snapshot, "self", "1.0.0")).toEqual({ newer: ["2.0.0"], older: ["0.9.0"] });
    });
});
