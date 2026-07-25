import { describe, expect, it } from "vitest";
import {
    SECURITY_SEED_DOCUMENT_ID,
    changedSynchronisationParameterFields,
    fingerprintSecuritySeed,
    replaceSecuritySeed,
    requireSecuritySeedDocument,
    snapshotSecuritySeedDocument,
} from "./securitySeed.ts";

const seedA = Buffer.alloc(32, 1).toString("base64");
const seedB = Buffer.alloc(32, 2).toString("base64");

describe("Security Seed E2E evidence", () => {
    it("reports stable, non-secret fingerprints", () => {
        expect(fingerprintSecuritySeed(seedA)).toMatch(/^sha256:[0-9a-f]{16}$/u);
        expect(fingerprintSecuritySeed(seedA)).toBe(fingerprintSecuritySeed(seedA));
        expect(fingerprintSecuritySeed(seedA)).not.toBe(fingerprintSecuritySeed(seedB));
    });

    it("redacts the Seed from the machine-readable document snapshot", () => {
        const document = requireSecuritySeedDocument({
            _id: SECURITY_SEED_DOCUMENT_ID,
            _rev: "0-1",
            type: "syncinfo",
            protocolVersion: 2,
            pbkdf2salt: seedA,
        });

        const snapshot = snapshotSecuritySeedDocument(document);

        expect(snapshot).toEqual({
            id: SECURITY_SEED_DOCUMENT_ID,
            revision: "0-1",
            fingerprint: fingerprintSecuritySeed(seedA),
            fields: {
                type: "syncinfo",
                protocolVersion: 2,
            },
        });
        expect(JSON.stringify(snapshot)).not.toContain(seedA);
    });

    it("replaces only the Seed and identifies later synchronisation-parameter changes", () => {
        const before = requireSecuritySeedDocument({
            _id: SECURITY_SEED_DOCUMENT_ID,
            _rev: "0-1",
            type: "syncinfo",
            protocolVersion: 2,
            pbkdf2salt: seedA,
        });
        const replaced = replaceSecuritySeed(before, seedB);
        const laterRevision = {
            ...replaced,
            _rev: "0-3",
        };

        expect(before.pbkdf2salt).toBe(seedA);
        expect(replaced.pbkdf2salt).toBe(seedB);
        expect(changedSynchronisationParameterFields(before, replaced)).toEqual(["pbkdf2salt"]);
        expect(changedSynchronisationParameterFields(replaced, laterRevision)).toEqual([]);
    });
});
