import { describe, expect, it, vi } from "vitest";

import { createCustomisationSyncCodec, type PluginDataEx } from "./customisationSyncCodec.ts";

function createCodec() {
    const digestHash = vi.fn((data: string[]) => `digest:${data.join("|")}`);
    const parseYaml = vi.fn((_source: string): unknown => {
        throw new Error("Invalid YAML");
    });
    return {
        codec: createCustomisationSyncCodec({ digestHash, parseYaml }),
        digestHash,
        parseYaml,
    };
}

const data: PluginDataEx = {
    category: "PLUGIN_DATA",
    name: "example",
    term: "device-a",
    version: "1.2.3",
    mtime: 123,
    files: [
        {
            filename: ".obsidian/plugins/example/data.json",
            displayName: "data.json",
            version: "2.0.0",
            mtime: 120,
            size: 6,
            data: ["YWJj", "ZGVm"],
        },
    ],
};

describe("compatibility: Customisation Sync codec", () => {
    it("preserves the existing custom wire format", () => {
        const { codec, digestHash } = createCodec();

        expect(codec.serialize(data)).toBe(
            ":PLUGIN_DATA\u200bexample\u200bdevice-a\n" +
                "1.2.3\n" +
                "123\n" +
                ".obsidian/plugins/example/data.json\u200bdata.json\u200b2.0.0\n" +
                "120\u200b6\u200bdigest:YWJj|ZGVm\n" +
                "YWJj\u200bZGVm\u200b\n"
        );
        expect(digestHash).toHaveBeenCalledWith(["YWJj", "ZGVm"]);
    });

    it("round-trips the custom format across arbitrary source chunks", () => {
        const { codec } = createCodec();
        const serialised = codec.serialize(data);
        const source = [serialised.slice(0, 13), serialised.slice(13, 47), serialised.slice(47), ""];

        expect(codec.deserialize<PluginDataEx>(source, {} as PluginDataEx)).toEqual({
            ...data,
            files: [
                {
                    ...data.files[0],
                    hash: "digest:YWJj|ZGVm",
                },
            ],
        });
    });

    it("retains JSON as the first legacy fallback", () => {
        const { codec, parseYaml } = createCodec();

        expect(codec.deserialize(['{"value":1}'], { value: 0 })).toEqual({ value: 1 });
        expect(parseYaml).not.toHaveBeenCalled();
    });

    it("uses the injected YAML parser after JSON parsing fails", () => {
        const parseYaml = vi.fn(() => ({ value: 2 }));
        const codec = createCustomisationSyncCodec({ digestHash: vi.fn(() => "hash"), parseYaml });

        expect(codec.deserialize(["value: 2"], { value: 0 })).toEqual({ value: 2 });
        expect(parseYaml).toHaveBeenCalledWith("value: 2");
    });

    it("returns the supplied default when every decoder rejects the input", () => {
        const { codec } = createCodec();
        const defaultValue = { retained: true };

        expect(codec.deserialize([], defaultValue)).toBe(defaultValue);
    });

    it("preserves the V2 migration sentinels", () => {
        const { codec } = createCodec();

        expect(codec.dummyHead).toBe(":CONFIG\u200bmigrated\u200b-\n\n0\n");
        expect(codec.dummyEnd).toBe("\u200b\n\u200c");
    });
});
