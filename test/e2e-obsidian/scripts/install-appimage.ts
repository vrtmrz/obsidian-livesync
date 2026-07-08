import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { get } from "node:https";
import { arch } from "node:process";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const defaultVersion = "1.12.7";

function appImageArch(): string {
    const requestedArch = process.env.E2E_OBSIDIAN_APPIMAGE_ARCH?.trim();
    if (requestedArch) {
        return requestedArch;
    }
    if (arch === "arm64") {
        return "arm64";
    }
    if (arch === "x64") {
        return "x86_64";
    }
    throw new Error(`Unsupported architecture for Obsidian AppImage: ${arch}`);
}

function appImageUrl(version: string, imageArch: string): string {
    return `https://github.com/obsidianmd/obsidian-releases/releases/download/v${version}/Obsidian-${version}-${imageArch}.AppImage`;
}

function download(url: string, destination: string, redirectsLeft = 5): Promise<void> {
    return new Promise((resolveDownload, reject) => {
        const request = get(url, (response) => {
            const statusCode = response.statusCode ?? 0;
            const location = response.headers.location;
            if (statusCode >= 300 && statusCode < 400 && location) {
                response.resume();
                if (redirectsLeft <= 0) {
                    reject(new Error(`Too many redirects while downloading ${url}`));
                    return;
                }
                download(new URL(location, url).toString(), destination, redirectsLeft - 1)
                    .then(resolveDownload)
                    .catch(reject);
                return;
            }
            if (statusCode !== 200) {
                response.resume();
                reject(new Error(`Failed to download ${url}: HTTP ${statusCode}`));
                return;
            }

            const file = createWriteStream(destination, { mode: 0o755 });
            response.pipe(file);
            file.on("finish", () => {
                file.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolveDownload();
                    }
                });
            });
            file.on("error", reject);
        });
        request.on("error", reject);
    });
}

function extractAppImage(appImagePath: string, cwd: string): Promise<void> {
    return new Promise((resolveExtract, reject) => {
        const child = spawn(appImagePath, ["--appimage-extract"], {
            cwd,
            stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code, signal) => {
            if (code === 0) {
                resolveExtract();
                return;
            }
            reject(new Error(`AppImage extraction failed. code=${code}, signal=${signal}`));
        });
    });
}

async function main(): Promise<void> {
    const version = process.env.E2E_OBSIDIAN_VERSION?.trim() || defaultVersion;
    const imageArch = appImageArch();
    const targetDir = resolve(process.env.E2E_OBSIDIAN_DOWNLOAD_DIR?.trim() || "_testdata/obsidian");
    const url = process.env.E2E_OBSIDIAN_APPIMAGE_URL?.trim() || appImageUrl(version, imageArch);
    const appImagePath = join(targetDir, basename(new URL(url).pathname));
    const extractedBinary = join(targetDir, "squashfs-root", "obsidian");
    const forceDownload = process.env.E2E_OBSIDIAN_FORCE_DOWNLOAD === "true";
    const skipExtract = process.env.E2E_OBSIDIAN_SKIP_EXTRACT === "true";

    await mkdir(targetDir, { recursive: true });

    if (!existsSync(appImagePath) || forceDownload) {
        console.log(`Downloading Obsidian AppImage: ${url}`);
        console.log(`Destination: ${appImagePath}`);
        await download(url, appImagePath);
        await chmod(appImagePath, 0o755);
    } else {
        console.log(`Using existing Obsidian AppImage: ${appImagePath}`);
    }

    if (!skipExtract) {
        if (existsSync(extractedBinary)) {
            console.log(`Using existing extracted Obsidian binary: ${extractedBinary}`);
        } else {
            console.log(`Extracting Obsidian AppImage in ${targetDir}`);
            await extractAppImage(appImagePath, targetDir);
            console.log(`Extracted Obsidian binary: ${extractedBinary}`);
        }
    }

    console.log(`Set OBSIDIAN_BINARY=${extractedBinary} to use the extracted binary explicitly.`);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
