import { runScenario } from "./test-e2e-two-vaults-couchdb.ts";

type MatrixCase = {
    remoteType: "COUCHDB" | "MINIO";
    encrypt: boolean;
    label: string;
};

const matrixCases: MatrixCase[] = [
    { remoteType: "COUCHDB", encrypt: false, label: "COUCHDB-enc0" },
    { remoteType: "COUCHDB", encrypt: true, label: "COUCHDB-enc1" },
    { remoteType: "MINIO", encrypt: false, label: "MINIO-enc0" },
    { remoteType: "MINIO", encrypt: true, label: "MINIO-enc1" },
];

for (const tc of matrixCases) {
    Deno.test(`e2e matrix: ${tc.label}`, async () => {
        await runScenario(tc.remoteType, tc.encrypt);
    });
}
