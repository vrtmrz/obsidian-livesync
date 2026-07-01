import { spawn } from "node:child_process";

type Step = {
    name: string;
    args: string[];
    optional?: boolean;
};

const testSteps: Step[] = [
    { name: "build", args: ["run", "build"] },
    { name: "discover", args: ["run", "test:e2e:obsidian:discover"] },
    { name: "smoke", args: ["run", "test:e2e:obsidian:smoke"] },
    { name: "vault reflection", args: ["run", "test:e2e:obsidian:vault-reflection"] },
    { name: "CouchDB upload", args: ["run", "test:e2e:obsidian:couchdb-upload"] },
    { name: "Object Storage upload", args: ["run", "test:e2e:obsidian:minio-upload"] },
    { name: "startup scan", args: ["run", "test:e2e:obsidian:startup-scan"] },
    { name: "two-vault synchronisation", args: ["run", "test:e2e:obsidian:two-vault-sync"] },
    { name: "hidden file snippet synchronisation", args: ["run", "test:e2e:obsidian:hidden-file-snippet-sync"] },
    { name: "Customisation Sync", args: ["run", "test:e2e:obsidian:customisation-sync"] },
    { name: "setting Markdown export", args: ["run", "test:e2e:obsidian:setting-markdown-export"] },
];

const manageCouchDb = process.argv.includes("--manage-couchdb") || process.argv.includes("--manage-services");
const manageMinio = process.argv.includes("--manage-minio") || process.argv.includes("--manage-services");
const keepServices = process.argv.includes("--keep-services");
const keepCouchDb = keepServices || process.argv.includes("--keep-couchdb");
const keepMinio = keepServices || process.argv.includes("--keep-minio");

function npmBinary(): string {
    return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runStep(step: Step): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`\n# ${step.name}`);
        const child = spawn(npmBinary(), step.args, {
            cwd: process.cwd(),
            env: process.env,
            stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            const message = `${step.name} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`;
            if (step.optional) {
                console.warn(message);
                resolve();
                return;
            }
            reject(new Error(message));
        });
    });
}

async function stopManagedCouchDb(): Promise<void> {
    await runStep({
        name: "stop CouchDB fixture",
        args: ["run", "test:docker-couchdb:stop"],
        optional: true,
    });
}

async function stopManagedMinio(): Promise<void> {
    await runStep({
        name: "stop MinIO fixture",
        args: ["run", "test:docker-s3:stop"],
        optional: true,
    });
}

async function main(): Promise<void> {
    let shouldStopCouchDb = false;
    let shouldStopMinio = false;
    try {
        if (manageCouchDb) {
            await stopManagedCouchDb();
            await runStep({ name: "start CouchDB fixture", args: ["run", "test:docker-couchdb:start"] });
            shouldStopCouchDb = !keepCouchDb;
        }
        if (manageMinio) {
            await stopManagedMinio();
            await runStep({ name: "start MinIO fixture", args: ["run", "test:docker-s3:start"] });
            shouldStopMinio = !keepMinio;
        }

        for (const step of testSteps) {
            await runStep(step);
        }
    } finally {
        if (shouldStopMinio) {
            await stopManagedMinio();
        }
        if (shouldStopCouchDb) {
            await stopManagedCouchDb();
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
