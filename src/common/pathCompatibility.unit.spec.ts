import { describe, expect, it } from "vitest";
import {
    ANDROID_LINUX_PATH_COMPONENT_UTF8_WARNING_BOUNDARY,
    findPathComponentsExceedingUtf8Limit,
} from "./pathCompatibility.ts";

describe("findPathComponentsExceedingUtf8Limit", () => {
    it("accepts 255 UTF-8 bytes and reports 256 UTF-8 bytes", () => {
        expect(findPathComponentsExceedingUtf8Limit("a".repeat(255))).toEqual([]);
        expect(findPathComponentsExceedingUtf8Limit("a".repeat(256))).toEqual([
            {
                component: "a".repeat(256),
                utf8Bytes: 256,
            },
        ]);
    });

    it("counts UTF-8 bytes rather than JavaScript characters", () => {
        expect(findPathComponentsExceedingUtf8Limit("界".repeat(85))).toEqual([]);
        expect(findPathComponentsExceedingUtf8Limit(`${"界".repeat(85)}a`)).toEqual([
            {
                component: `${"界".repeat(85)}a`,
                utf8Bytes: 256,
            },
        ]);
    });

    it("does not apply the component limit to the whole path", () => {
        const path = `${"a".repeat(200)}/${"b".repeat(200)}`;

        expect(new TextEncoder().encode(path).byteLength).toBeGreaterThan(
            ANDROID_LINUX_PATH_COMPONENT_UTF8_WARNING_BOUNDARY
        );
        expect(findPathComponentsExceedingUtf8Limit(path)).toEqual([]);
    });

    it("reports an oversized folder component as well as an oversized file name", () => {
        const folder = "界".repeat(86);
        const file = `${"b".repeat(256)}.md`;

        expect(findPathComponentsExceedingUtf8Limit(`parent/${folder}/${file}`)).toEqual([
            { component: folder, utf8Bytes: 258 },
            { component: file, utf8Bytes: 259 },
        ]);
    });
});
