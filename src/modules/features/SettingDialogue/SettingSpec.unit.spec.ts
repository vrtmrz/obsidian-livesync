import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { statusDisplay, type ConfigurationItem } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { getConfig, type OnDialogSettings } from "./settingConstants.ts";
import {
    renderLegacySettingSpec,
    toLegacySettingBinding,
    toObsidianSettingDefinition,
    type PersistedSettingKey,
    type SettingSpec,
} from "./SettingSpec.ts";
import { createAdvancedSettingSpecGroups } from "./AdvancedSettingSpecs.ts";

const rangeMessages = {
    valueShouldBeInRange: ({ min, max }: { min?: number; max?: number }) => `${min ?? "~"}..${max ?? "~"}`,
};

describe("Advanced setting specifications", () => {
    it("lists only the nine controls currently exposed by the Advanced page", () => {
        const groups = createAdvancedSettingSpecGroups({ isCouchDB: () => true });

        expect(groups.map(({ heading }) => heading)).toEqual([
            "Memory cache",
            "Local Database Tweak",
            "Transfer Tweak",
            "Remote Database Tweak",
        ]);
        expect(groups.flatMap(({ items }) => items.map(({ key }) => key))).toEqual([
            "hashCacheMaxCount",
            "chunkSplitterVersion",
            "customChunkSize",
            "readChunksOnline",
            "useOnlyLocalChunk",
            "concurrencyOfReadChunksOnline",
            "minimumIntervalOfReadChunksOnline",
            "autoAcceptCompatibleTweak",
            "enableCompression",
        ]);
    });

    it("keeps CouchDB visibility on the four remote chunk controls", () => {
        let couchDB = false;
        const groups = createAdvancedSettingSpecGroups({ isCouchDB: () => couchDB });
        const conditional = groups.flatMap(({ items }) => items).filter(({ visible }) => visible !== undefined);

        expect(conditional.map(({ key }) => key)).toEqual([
            "readChunksOnline",
            "useOnlyLocalChunk",
            "concurrencyOfReadChunksOnline",
            "minimumIntervalOfReadChunksOnline",
        ]);
        expect(conditional.every(({ visible }) => visible?.() === false)).toBe(true);

        couchDB = true;
        expect(conditional.every(({ visible }) => visible?.() === true)).toBe(true);
    });

    it("excludes transient settings-dialogue keys from the persisted key type", () => {
        type OnDialogOverlap = Extract<keyof OnDialogSettings, PersistedSettingKey>;
        expectTypeOf<OnDialogOverlap>().toEqualTypeOf<never>();
    });

    it("resolves translated Commonlib metadata for every explicitly exposed key", () => {
        const specs = createAdvancedSettingSpecGroups({ isCouchDB: () => true }).flatMap(({ items }) => items);

        for (const spec of specs) {
            const metadata = getConfig(spec.key);
            expect(metadata, spec.key).not.toBe(false);
            if (!metadata) {
                throw new Error(`Missing setting metadata for ${spec.key}`);
            }
            const definition = toObsidianSettingDefinition(spec, metadata, rangeMessages);
            expect(definition.name).toBe(`${metadata.name}${statusDisplay(metadata.status)}`);
        }
    });
});

describe("SettingSpec conversion", () => {
    it("maps metadata and a toggle to an Obsidian definition without importing the runtime API", () => {
        const visible = vi.fn(() => true);
        const disabled = vi.fn(() => false);
        const spec: SettingSpec = {
            key: "autoAcceptCompatibleTweak",
            control: { type: "toggle", defaultValue: true },
            aliases: ["compatible tweaks"],
            visible,
            disabled,
        };
        const metadata = {
            name: "Automatic compatibility",
            desc: "Accept compatible values.",
            status: "BETA",
        } satisfies ConfigurationItem;

        expect(toObsidianSettingDefinition(spec, metadata, rangeMessages)).toEqual({
            name: `Automatic compatibility${statusDisplay("BETA")}`,
            desc: "Accept compatible values.",
            aliases: ["compatible tweaks"],
            visible,
            control: {
                type: "toggle",
                key: "autoAcceptCompatibleTweak",
                defaultValue: true,
                disabled,
            },
        });
    });

    it("maps dropdown options to both native and legacy representations", () => {
        const options = {
            "v3-rabin-karp": "V3",
            legacy: "Legacy",
        };
        const spec: SettingSpec = {
            key: "chunkSplitterVersion",
            control: { type: "dropdown", options: () => options },
        };
        const metadata = {
            name: "Chunk splitter",
            placeHolder: "Select a splitter",
        } satisfies ConfigurationItem;

        expect(toObsidianSettingDefinition(spec, metadata, rangeMessages).control).toEqual({
            type: "dropdown",
            key: "chunkSplitterVersion",
            options,
        });
        expect(toLegacySettingBinding(spec)).toEqual({
            type: "dropdown",
            key: "chunkSplitterVersion",
            options: { options },
        });
    });

    it("maps number limits and zero exceptions to equivalent validation", () => {
        const spec: SettingSpec = {
            key: "hashCacheMaxCount",
            control: { type: "number", min: 10, max: 100, allowZero: true },
        };
        const metadata = { name: "Cache size" } satisfies ConfigurationItem;
        const definition = toObsidianSettingDefinition(spec, metadata, rangeMessages);
        const control = definition.control;

        expect(control).toMatchObject({
            type: "number",
            key: "hashCacheMaxCount",
            min: 0,
            max: 100,
        });
        if (control.type !== "number") {
            throw new Error("Expected a number control");
        }
        expect(control.validate?.(0)).toBeUndefined();
        expect(control.validate?.(10)).toBeUndefined();
        expect(control.validate?.(5)).toBe("10..100");
        expect(control.validate?.(101)).toBe("10..100");
        expect(toLegacySettingBinding(spec)).toEqual({
            type: "number",
            key: "hashCacheMaxCount",
            options: { clampMin: 10, clampMax: 100, acceptZero: true },
        });
    });

    it("checks the maximum before applying a zero exception, as the legacy renderer does", () => {
        const spec: SettingSpec = {
            key: "hashCacheMaxCount",
            control: { type: "number", max: -1, allowZero: true },
        };
        const definition = toObsidianSettingDefinition(spec, { name: "Cache size" }, rangeMessages);
        const control = definition.control;
        if (control.type !== "number") {
            throw new Error("Expected a number control");
        }

        expect(control.validate?.(0)).toBe("~..-1");
    });

    it("dispatches a specification through the existing AutoWire renderer", () => {
        const renderer = {
            autoWireToggle: vi.fn(),
            autoWireNumeric: vi.fn(),
            autoWireDropDown: vi.fn(),
        };
        const visible = vi.fn(() => false);
        const spec: SettingSpec = {
            key: "readChunksOnline",
            control: { type: "toggle" },
            visible,
        };

        renderLegacySettingSpec(renderer, spec);

        expect(renderer.autoWireToggle).toHaveBeenCalledOnce();
        const [, options] = renderer.autoWireToggle.mock.calls[0];
        expect(options.onUpdate()).toEqual({ visibility: false });
        expect(visible).toHaveBeenCalledOnce();
        expect(renderer.autoWireNumeric).not.toHaveBeenCalled();
        expect(renderer.autoWireDropDown).not.toHaveBeenCalled();
    });
});
