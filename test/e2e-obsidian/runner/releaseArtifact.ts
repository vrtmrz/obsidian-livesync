import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type PinnedReleaseArtifactFile = {
    name: "main.js" | "manifest.json" | "styles.css";
    url: string;
    sha256: string;
};

export type PinnedPluginRelease = {
    pluginId: string;
    version: string;
    files: readonly PinnedReleaseArtifactFile[];
};

export type EnsurePinnedReleaseArtifactOptions = {
    artifactRoot?: string;
    fetchImplementation?: typeof fetch;
};

export const UPGRADE_SOURCE_RELEASE: PinnedPluginRelease = {
    pluginId: "obsidian-livesync",
    version: "0.25.83",
    files: [
        {
            name: "main.js",
            url: "https://github.com/vrtmrz/obsidian-livesync/releases/download/0.25.83/main.js",
            sha256: "5e57f990635ab0cf2ff3879f3c6cb91ddfdbc146958d33d1e5d21f1869dff6a4",
        },
        {
            name: "manifest.json",
            url: "https://github.com/vrtmrz/obsidian-livesync/releases/download/0.25.83/manifest.json",
            sha256: "4944f5665c94bcbb58db0e3708ec2bd8ee36118791271c01d085668876dc8ba6",
        },
        {
            name: "styles.css",
            url: "https://github.com/vrtmrz/obsidian-livesync/releases/download/0.25.83/styles.css",
            sha256: "37d31798186d7e97ea979e6d2aae8021ea1ac1df2c3b9d2b03dce269959c27f3",
        },
    ],
};

function digest(content: Uint8Array<ArrayBuffer>): string {
    return createHash("sha256").update(content).digest("hex");
}

function assertDigest(file: PinnedReleaseArtifactFile, content: Uint8Array<ArrayBuffer>): void {
    const actual = digest(content);
    if (actual !== file.sha256) {
        throw new Error(
            `Release artefact checksum mismatch for ${file.name}. Expected ${file.sha256}, received ${actual}.`
        );
    }
}

async function readCachedFile(
    path: string,
    file: PinnedReleaseArtifactFile
): Promise<Uint8Array<ArrayBuffer> | undefined> {
    try {
        const content = new Uint8Array(await readFile(path));
        assertDigest(file, content);
        return content;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

async function downloadVerifiedFile(
    root: string,
    file: PinnedReleaseArtifactFile,
    fetchImplementation: typeof fetch
): Promise<Uint8Array<ArrayBuffer>> {
    const path = join(root, file.name);
    const cached = await readCachedFile(path, file);
    if (cached) return cached;

    const response = await fetchImplementation(file.url, { redirect: "follow" });
    if (!response.ok) {
        throw new Error(`Could not download ${file.url}. HTTP ${response.status}: ${await response.text()}`);
    }
    const content = new Uint8Array(await response.arrayBuffer());
    assertDigest(file, content);

    const temporaryPath = `${path}.download-${process.pid}-${Date.now()}`;
    try {
        await writeFile(temporaryPath, content, { flag: "wx" });
        await rename(temporaryPath, path);
    } finally {
        await rm(temporaryPath, { force: true });
    }
    return content;
}

/**
 * Materialise one immutable published plug-in release in the ignored E2E cache.
 *
 * Existing files are always verified before use. A mismatched cache is left in
 * place for inspection and must be removed explicitly by the operator.
 */
export async function ensurePinnedReleaseArtifact(
    release: PinnedPluginRelease = UPGRADE_SOURCE_RELEASE,
    options: EnsurePinnedReleaseArtifactOptions = {}
): Promise<string> {
    const root = resolve(
        options.artifactRoot ??
            process.env.E2E_LIVESYNC_SOURCE_ARTIFACT_ROOT?.trim() ??
            join("_testdata", "releases", release.pluginId, release.version)
    );
    await mkdir(root, { recursive: true });

    const fetched = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const file of release.files) {
        fetched.set(file.name, await downloadVerifiedFile(root, file, options.fetchImplementation ?? fetch));
    }

    const manifestBytes = fetched.get("manifest.json");
    if (!manifestBytes) throw new Error("The pinned release does not define manifest.json.");
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as { id?: unknown; version?: unknown };
    if (manifest.id !== release.pluginId || manifest.version !== release.version) {
        throw new Error(
            `Release manifest identity mismatch. Expected ${release.pluginId}@${release.version}, received ${String(manifest.id)}@${String(manifest.version)}.`
        );
    }
    return root;
}
