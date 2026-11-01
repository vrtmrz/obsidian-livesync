// This module belongs exclusively to the Node.js CLI host.
import { Sha256 } from "@aws-crypto/sha256-js";
import { fs, path } from "@vrtmrz/livesync-commonlib/node";
import type { CLICommand } from "./commands/types";

function sha256Hex(value: string): string {
    const hash = new Sha256();
    hash.update(new TextEncoder().encode(value));
    return Array.from(hash.digestSync(), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function runtimeScopeDirectory(databasePath: string, databaseName: string, vaultPath: string): string {
    const scope = sha256Hex(vaultPath);
    return path.join(runtimeDatabaseDirectory(databasePath, databaseName), scope);
}

export function runtimeDatabaseDirectory(databasePath: string, databaseName: string): string {
    const database = sha256Hex(databaseName);
    return path.join(databasePath, ".livesync", "runtime", "scopes", database);
}

export function writeFileAtomically(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        const descriptor = fs.openSync(temporaryPath, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, content, "utf-8");
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(temporaryPath, filePath);
        syncDirectory(path.dirname(filePath));
    } finally {
        fs.rmSync(temporaryPath, { force: true });
    }
}

function syncDirectory(directory: string): void {
    // Windows does not support opening a directory for fsync.
    if (process.platform === "win32") return;
    const descriptor = fs.openSync(directory, "r");
    try {
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}

export function readOptionalFile(filePath: string): string | undefined {
    try {
        return fs.readFileSync(filePath, "utf-8");
    } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return undefined;
        throw error;
    }
}

export function isReconstructionCommand(command: CLICommand): command is "fetch" | "rebuild" {
    return command === "fetch" || command === "rebuild";
}

const READ_COMMANDS = new Set<CLICommand>([
    "cat",
    "cat-rev",
    "ls",
    "info",
    "remote-ls",
    "remote-export",
    "remote-status",
    "p2p-peers",
]);

export function isMutatingCommand(command: CLICommand): boolean {
    return !READ_COMMANDS.has(command);
}

interface ReconstructionMarker {
    version: 1;
    command: "fetch" | "rebuild";
    databasePath: string;
    vaultPath: string;
    settingsPath: string;
    settingsBeforeHash: string;
    phase: "running" | "completed";
    settingsText?: string;
}

function hashSettings(content: string | undefined): string {
    return sha256Hex(JSON.stringify(content ?? null));
}

export class ReconstructionState {
    readonly markerPath: string;
    private marker: ReconstructionMarker | undefined;

    constructor(
        private readonly databasePath: string,
        private readonly vaultPath: string,
        private readonly settingsPath: string
    ) {
        this.markerPath = path.join(databasePath, ".livesync", "reconstruction.json");
    }

    prepare(command: CLICommand, force: boolean, writeSettings = false): void {
        const contents = readOptionalFile(this.markerPath);
        if (contents !== undefined) {
            const parsed: unknown = JSON.parse(contents);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                throw new Error(`Invalid reconstruction state: ${this.markerPath}. Preserve it for recovery.`);
            }
            const marker = parsed as ReconstructionMarker;
            if (
                marker.version !== 1 ||
                !isReconstructionCommand(marker.command) ||
                (marker.phase !== "running" && marker.phase !== "completed") ||
                typeof marker.settingsPath !== "string" ||
                typeof marker.vaultPath !== "string" ||
                typeof marker.settingsBeforeHash !== "string" ||
                marker.databasePath !== this.databasePath ||
                (marker.phase === "completed" && typeof marker.settingsText !== "string")
            ) {
                throw new Error(`Invalid reconstruction state: ${this.markerPath}. Preserve it for recovery.`);
            }
            this.marker = marker;
            if (marker.phase === "completed") {
                this.commit();
            } else if (
                (isMutatingCommand(command) || writeSettings) &&
                !(
                    command === marker.command &&
                    force &&
                    marker.vaultPath === this.vaultPath &&
                    marker.settingsPath === this.settingsPath
                )
            ) {
                throw new Error(
                    `An interrupted ${marker.command} requires recovery. Retry ${marker.command} --force with the same database, Vault, and settings paths. State: ${this.markerPath}`
                );
            }
        }
        if (isReconstructionCommand(command)) {
            this.marker = {
                version: 1,
                command,
                databasePath: this.databasePath,
                vaultPath: this.vaultPath,
                settingsPath: this.settingsPath,
                phase: "running",
                settingsBeforeHash: hashSettings(readOptionalFile(this.settingsPath)),
            };
            this.save();
        }
    }

    complete(settingsText: string): void {
        if (!this.marker || this.marker.phase !== "running") throw new Error("Reconstruction was not started.");
        this.marker = { ...this.marker, phase: "completed", settingsText };
        this.save();
    }

    commit(): void {
        const marker = this.marker;
        if (!marker || marker.phase !== "completed" || marker.settingsText === undefined) {
            throw new Error("Reconstruction has no completed settings update.");
        }
        const current = readOptionalFile(marker.settingsPath);
        if (current !== marker.settingsText && hashSettings(current) !== marker.settingsBeforeHash) {
            throw new Error(
                `The settings file changed after reconstruction: ${marker.settingsPath}. Preserve the reconstruction state and review both settings versions before continuing.`
            );
        }
        if (current !== marker.settingsText) writeFileAtomically(marker.settingsPath, marker.settingsText);
        this.clear();
    }

    clear(): void {
        fs.rmSync(this.markerPath, { force: true });
        syncDirectory(path.dirname(this.markerPath));
        this.marker = undefined;
    }

    private save(): void {
        writeFileAtomically(this.markerPath, JSON.stringify(this.marker, null, 2));
    }
}

export interface LegacyStateIssue {
    path: string;
    reason: "unowned" | "invalid" | "unreadable";
}

export function inspectLegacyState(databasePath: string, vaultPath: string): LegacyStateIssue[] {
    const issues: LegacyStateIssue[] = [];
    for (const [filePath, expectArray] of [
        [path.join(databasePath, ".livesync", "runtime", "keyvalue-db.json"), false],
        [path.join(vaultPath, ".livesync-snapshot.json"), true],
    ] as const) {
        let contents: string | undefined;
        try {
            contents = readOptionalFile(filePath);
        } catch {
            issues.push({ path: filePath, reason: "unreadable" });
            continue;
        }
        if (contents === undefined) continue;
        let value: unknown;
        try {
            value = JSON.parse(contents);
        } catch {
            issues.push({ path: filePath, reason: "invalid" });
            continue;
        }
        if (value === null || typeof value !== "object" || Array.isArray(value) !== expectArray) {
            issues.push({ path: filePath, reason: "invalid" });
        } else if (Object.keys(value).length > 0) {
            issues.push({ path: filePath, reason: "unowned" });
        }
    }
    return issues;
}
