import { spawn } from "node:child_process";

type Step = {
    name: string;
    args: string[];
    optional?: boolean;
};

const testSteps: Step[] = [
    { name: "build", args: ["run", "build"] },
    ...(process.env.LIVESYNC_CLI_COMMAND === undefined
        ? [{ name: "CLI build", args: ["run", "build", "-w", "self-hosted-livesync-cli"] }]
        : []),
    { name: "discover", args: ["run", "test:e2e:obsidian:discover"] },
    { name: "smoke", args: ["run", "test:e2e:obsidian:smoke"] },
    { name: "onboarding invitation", args: ["run", "test:e2e:obsidian:onboarding-invitation"] },
    { name: "Svelte dialogue mounts", args: ["run", "test:e2e:obsidian:dialog-mounts"] },
    { name: "settings UI", args: ["run", "test:e2e:obsidian:settings-ui"] },
    { name: "Review Harness", args: ["run", "test:e2e:obsidian:review-harness"] },
    { name: "P2P status pane", args: ["run", "test:e2e:obsidian:p2p-pane"] },
    { name: "vault reflection", args: ["run", "test:e2e:obsidian:vault-reflection"] },
    { name: "CouchDB upload", args: ["run", "test:e2e:obsidian:couchdb-upload"] },
    {
        name: "manual CouchDB setup workflow",
        args: ["run", "test:e2e:obsidian:couchdb-manual-setup-workflow"],
    },
    {
        name: "CLI to real Obsidian synchronisation",
        args: ["run", "test:e2e:obsidian:cli-to-obsidian-sync"],
    },
    { name: "Object Storage upload", args: ["run", "test:e2e:obsidian:minio-upload"] },
    {
        name: "Object Storage Setup URI workflow",
        args: ["run", "test:e2e:obsidian:object-storage-setup-uri-workflow"],
    },
    { name: "P2P Setup URI workflow", args: ["run", "test:e2e:obsidian:p2p-setup-uri-workflow"] },
    { name: "startup scan", args: ["run", "test:e2e:obsidian:startup-scan"] },
    { name: "provisioned Setup URI workflow", args: ["run", "test:e2e:obsidian:setup-uri-workflow"] },
    { name: "two-vault synchronisation", args: ["run", "test:e2e:obsidian:two-vault-sync"] },
    { name: "hidden file snippet synchronisation", args: ["run", "test:e2e:obsidian:hidden-file-snippet-sync"] },
    { name: "Customisation Sync", args: ["run", "test:e2e:obsidian:customisation-sync"] },
    { name: "setting Markdown export", args: ["run", "test:e2e:obsidian:setting-markdown-export"] },
];

const manageCouchDb = process.argv.includes("--manage-couchdb") || process.argv.includes("--manage-services");
const manageMinio = process.argv.includes("--manage-minio") || process.argv.includes("--manage-services");
const manageP2P = process.argv.includes("--manage-p2p") || process.argv.includes("--manage-services");
const keepServices = process.argv.includes("--keep-services");
const keepCouchDb = keepServices || process.argv.includes("--keep-couchdb");
const keepMinio = keepServices || process.argv.includes("--keep-minio");
const keepP2P = keepServices || process.argv.includes("--keep-p2p");

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

async function stopManagedP2P(): Promise<void> {
    await runStep({
        name: "stop P2P relay fixture",
        args: ["run", "test:docker-p2p:stop"],
        optional: true,
    });
}

async function main(): Promise<void> {
    let shouldStopCouchDb = false;
    let shouldStopMinio = false;
    let shouldStopP2P = false;
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
        if (manageP2P) {
            await stopManagedP2P();
            await runStep({ name: "start P2P relay fixture", args: ["run", "test:docker-p2p:start"] });
            shouldStopP2P = !keepP2P;
        }

        for (const step of testSteps) {
            await runStep(step);
        }
    } finally {
        if (shouldStopP2P) {
            await stopManagedP2P();
        }
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
