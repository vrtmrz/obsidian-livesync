import { accessSync, constants, existsSync } from "node:fs";
import { resolve } from "node:path";
import { platform } from "node:process";

export type ObsidianDiscoveryResult = {
    binary?: string;
    source?: string;
    checked: string[];
};

const defaultCandidatesByPlatform: Record<NodeJS.Platform, string[]> = {
    aix: [],
    android: [],
    darwin: [
        "/Applications/Obsidian.app/Contents/MacOS/Obsidian",
        "/Applications/Obsidian.app/Contents/MacOS/obsidian",
    ],
    freebsd: [],
    haiku: [],
    linux: [
        "_testdata/obsidian/squashfs-root/obsidian",
        "_testdata/obsidian/squashfs-root/AppRun",
        "_testdata/obsidian/Obsidian-1.12.7-arm64.AppImage",
        "_testdata/obsidian/Obsidian-1.12.7-x86_64.AppImage",
        "/usr/bin/obsidian",
        "/usr/local/bin/obsidian",
        "/snap/bin/obsidian",
        "/opt/Obsidian/obsidian",
        "/opt/obsidian/obsidian",
        "/app/bin/obsidian",
    ],
    openbsd: [],
    sunos: [],
    win32: ["C:\\Program Files\\Obsidian\\Obsidian.exe", "C:\\Program Files (x86)\\Obsidian\\Obsidian.exe"],
    cygwin: [],
    netbsd: [],
};

const defaultCliCandidatesByPlatform: Record<NodeJS.Platform, string[]> = {
    aix: [],
    android: [],
    darwin: [
        "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli",
        "/Applications/Obsidian.app/Contents/Resources/obsidian-cli",
    ],
    freebsd: [],
    haiku: [],
    linux: [
        "_testdata/obsidian/squashfs-root/obsidian-cli",
        "/usr/bin/obsidian-cli",
        "/usr/local/bin/obsidian-cli",
        "/snap/bin/obsidian-cli",
        "/opt/Obsidian/obsidian-cli",
        "/opt/obsidian/obsidian-cli",
    ],
    openbsd: [],
    sunos: [],
    win32: ["C:\\Program Files\\Obsidian\\obsidian-cli.exe", "C:\\Program Files (x86)\\Obsidian\\obsidian-cli.exe"],
    cygwin: [],
    netbsd: [],
};

function isUsableFile(path: string): boolean {
    const resolvedPath = resolve(path);
    if (!existsSync(resolvedPath)) {
        return false;
    }
    if (platform === "win32") {
        return true;
    }
    try {
        accessSync(resolvedPath, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

export function discoverObsidianBinary(env: NodeJS.ProcessEnv = process.env): ObsidianDiscoveryResult {
    const checked: string[] = [];
    const envBinary = env.OBSIDIAN_BINARY?.trim();
    if (envBinary) {
        checked.push(envBinary);
        if (isUsableFile(envBinary)) {
            return {
                binary: resolve(envBinary),
                source: "OBSIDIAN_BINARY",
                checked,
            };
        }
    }

    const candidates = defaultCandidatesByPlatform[platform] ?? [];
    for (const candidate of candidates) {
        checked.push(candidate);
        if (isUsableFile(candidate)) {
            return {
                binary: resolve(candidate),
                source: "default-path",
                checked,
            };
        }
    }

    return { checked };
}

export function requireObsidianBinary(env: NodeJS.ProcessEnv = process.env): string {
    const result = discoverObsidianBinary(env);
    if (!result.binary) {
        throw new Error(
            [
                "Could not find an Obsidian executable.",
                "Set OBSIDIAN_BINARY to the installed Obsidian executable path.",
                `Checked paths: ${result.checked.length > 0 ? result.checked.join(", ") : "(none)"}`,
            ].join("\n")
        );
    }
    return result.binary;
}

export function discoverObsidianCli(env: NodeJS.ProcessEnv = process.env): ObsidianDiscoveryResult {
    const checked: string[] = [];
    const envBinary = env.OBSIDIAN_CLI?.trim();
    if (envBinary) {
        checked.push(envBinary);
        if (isUsableFile(envBinary)) {
            return {
                binary: resolve(envBinary),
                source: "OBSIDIAN_CLI",
                checked,
            };
        }
    }

    const candidates = defaultCliCandidatesByPlatform[platform] ?? [];
    for (const candidate of candidates) {
        checked.push(candidate);
        if (isUsableFile(candidate)) {
            return {
                binary: resolve(candidate),
                source: "default-path",
                checked,
            };
        }
    }

    return { checked };
}
