/**
 * Supplies the runner-owned CouchDB fixture operations for the Security Seed
 * reconnect scenario. Production code remains responsible for fetching,
 * caching, and applying the Seed; this helper only validates the managed
 * synchronisation-parameter document, replaces the one intended field, and
 * compares document snapshots.
 *
 * Callers expose only short SHA-256 fingerprints. The original and replacement
 * Seed values must stay inside the isolated test process and must not be
 * written to diagnostics, screenshots, or machine-readable results.
 */
import { createHash, randomBytes } from "node:crypto";
import type { CouchDbDocument } from "./couchdb.ts";

export const SECURITY_SEED_DOCUMENT_ID = "_local/obsidian_livesync_sync_parameters";

export type SecuritySeedDocument = CouchDbDocument & {
    _id: typeof SECURITY_SEED_DOCUMENT_ID;
    _rev: string;
    pbkdf2salt: string;
};

export type SecuritySeedDocumentSnapshot = {
    id: string;
    revision: string;
    fingerprint: string;
    fields: Record<string, unknown>;
};

function decodeSecuritySeed(seed: string): Buffer {
    const bytes = Buffer.from(seed, "base64");
    if (seed.length === 0 || bytes.length === 0) {
        throw new Error("The Security Seed is empty or is not valid base64.");
    }
    return bytes;
}

export function createSecuritySeed(): string {
    return randomBytes(32).toString("base64");
}

export function fingerprintSecuritySeed(seed: string): string {
    const bytes = Uint8Array.from(decodeSecuritySeed(seed));
    return `sha256:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
}

export function requireSecuritySeedDocument(document: CouchDbDocument): SecuritySeedDocument {
    if (document._id !== SECURITY_SEED_DOCUMENT_ID) {
        throw new Error(`Unexpected synchronisation-parameter document: ${document._id}`);
    }
    if (typeof document._rev !== "string" || document._rev.length === 0) {
        throw new Error("The synchronisation-parameter document does not have a revision.");
    }
    if (typeof document.pbkdf2salt !== "string") {
        throw new Error("The synchronisation-parameter document does not have a Security Seed.");
    }
    decodeSecuritySeed(document.pbkdf2salt);
    return document as SecuritySeedDocument;
}

export function replaceSecuritySeed(document: SecuritySeedDocument, replacementSeed: string): SecuritySeedDocument {
    decodeSecuritySeed(replacementSeed);
    return {
        ...document,
        pbkdf2salt: replacementSeed,
    };
}

export function snapshotSecuritySeedDocument(document: SecuritySeedDocument): SecuritySeedDocumentSnapshot {
    const { _id, _rev, pbkdf2salt, ...fields } = document;
    return {
        id: _id,
        revision: _rev,
        fingerprint: fingerprintSecuritySeed(pbkdf2salt),
        fields,
    };
}

export function changedSynchronisationParameterFields(
    before: SecuritySeedDocument,
    after: SecuritySeedDocument
): string[] {
    const ignoredFields = new Set(["_rev"]);
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((key) => !ignoredFields.has(key))
        .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        .sort();
}
