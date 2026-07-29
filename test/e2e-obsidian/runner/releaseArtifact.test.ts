import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ensurePinnedReleaseArtifact,
    type PinnedPluginRelease,
} from "./releaseArtifact.ts";

const temporaryDirectories: string[] = [];

function sha256(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

function fixtureRelease(contents: Record<"main.js" | "manifest.json" | "styles.css", string>): PinnedPluginRelease {
    return {
        pluginId: "fixture-plugin",
        version: "1.2.3",
        files: (Object.keys(contents) as Array<keyof typeof contents>).map((name) => ({
            name,
            url: `https://example.invalid/${name}`,
            sha256: sha256(contents[name]),
        })),
    };
}

afterEach(async () => {
    for (const path of temporaryDirectories.splice(0)) {
        await rm(path, { recursive: true, force: true });
    }
});

describe("pinned plug-in release artefacts", () => {
    it("downloads, verifies, and reuses an immutable release cache", async () => {
        const root = await mkdtemp(join(tmpdir(), "livesync-release-artifact-"));
        temporaryDirectories.push(root);
        const contents = {
            "main.js": "console.log('fixture');\n",
            "manifest.json": '{"id":"fixture-plugin","version":"1.2.3"}\n',
            "styles.css": ".fixture {}\n",
        };
        const release = fixtureRelease(contents);
        const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
            const name = new URL(String(input)).pathname.split("/").pop() as keyof typeof contents;
            return new Response(contents[name], { status: 200 });
        }) as unknown as typeof fetch;

        await expect(
            ensurePinnedReleaseArtifact(release, { artifactRoot: root, fetchImplementation })
        ).resolves.toBe(root);
        await expect(readFile(join(root, "main.js"), "utf8")).resolves.toBe(contents["main.js"]);
        expect(fetchImplementation).toHaveBeenCalledTimes(3);

        await ensurePinnedReleaseArtifact(release, { artifactRoot: root, fetchImplementation });
        expect(fetchImplementation).toHaveBeenCalledTimes(3);
    });

    it("rejects a downloaded file before it enters the release cache when its checksum differs", async () => {
        const root = await mkdtemp(join(tmpdir(), "livesync-release-artifact-"));
        temporaryDirectories.push(root);
        const contents = {
            "main.js": "expected\n",
            "manifest.json": '{"id":"fixture-plugin","version":"1.2.3"}\n',
            "styles.css": ".fixture {}\n",
        };
        const release = fixtureRelease(contents);
        const fetchImplementation = vi.fn(async () => new Response("tampered\n", { status: 200 })) as unknown as typeof fetch;

        await expect(
            ensurePinnedReleaseArtifact(release, { artifactRoot: root, fetchImplementation })
        ).rejects.toThrow("checksum mismatch");
        await expect(readFile(join(root, "main.js"))).rejects.toMatchObject({ code: "ENOENT" });
    });
});
