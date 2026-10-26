import { access, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";

const BUILD_FILES = ["manifest.json", "main.js", "styles.css"] as const;

function hasErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function copyBuildFiles(destinations: readonly string[], sourceDirectory = process.cwd()): Plugin {
    return {
        name: "copy-build-files",
        async writeBundle() {
            let copied = false;
            for (const destination of destinations) {
                let destinationCreated = false;
                for (const file of BUILD_FILES) {
                    const source = join(sourceDirectory, file);
                    try {
                        await access(source);
                    } catch (error) {
                        if (hasErrorCode(error, "ENOENT")) continue;
                        throw error;
                    }

                    if (!destinationCreated) {
                        await mkdir(destination, { recursive: true });
                        destinationCreated = true;
                    }

                    const target = join(destination, file);
                    await copyFile(source, target);
                    if (!copied) console.log("copied:");
                    copied = true;
                    console.log(`  ${source} → ${target}`);
                }
            }
            if (!copied) console.log("no items to copy");
        },
    };
}
