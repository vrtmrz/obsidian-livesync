import * as path from "path";
import * as readline from "node:readline/promises";

export function toArrayBuffer(data: Buffer): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export function toVaultRelativePath(inputPath: string, vaultPath: string): string {
    const stripped = inputPath.replace(/^[/\\]+/, "");
    if (!path.isAbsolute(inputPath)) {
        const normalized = stripped.replace(/\\/g, "/");
        const resolved = path.resolve(vaultPath, normalized);
        const rel = path.relative(vaultPath, resolved);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new Error(`Path ${inputPath} is outside of the local database directory`);
        }
        return rel.replace(/\\/g, "/");
    }
    const resolved = path.resolve(inputPath);
    const rel = path.relative(vaultPath, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`Path ${inputPath} is outside of the local database directory`);
    }
    return rel.replace(/\\/g, "/");
}

export async function readStdinAsUtf8(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        if (typeof chunk === "string") {
            chunks.push(Buffer.from(chunk, "utf-8"));
        } else {
            chunks.push(chunk);
        }
    }
    return Buffer.concat(chunks).toString("utf-8");
}

export async function promptForPassphrase(prompt = "Enter setup URI passphrase: "): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const passphrase = await rl.question(prompt);
        if (!passphrase) {
            throw new Error("Passphrase is required");
        }
        return passphrase;
    } finally {
        rl.close();
    }
}
