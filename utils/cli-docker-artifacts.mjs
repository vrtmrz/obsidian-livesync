import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ARCHITECTURES = ["amd64", "arm64"];
const OUTCOMES = ["success", "failure", "cancelled", "skipped"];
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IMAGE_COMPONENT = "[a-z0-9]+(?:(?:[._]|__|[-]+)[a-z0-9]+)*";
const IMAGE_PATTERN = new RegExp(
    `^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?/)?${IMAGE_COMPONENT}(?:/${IMAGE_COMPONENT})*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$`
);

function assertArchitecture(arch) {
    if (!ARCHITECTURES.includes(arch)) {
        throw new Error(`Unsupported architecture: ${String(arch)}`);
    }
}

function assertExactKeys(record, expectedKeys) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
        throw new Error("Artifact record must be a JSON object");
    }
    const keys = Object.keys(record).sort();
    const expected = [...expectedKeys].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        throw new Error(`Artifact record must contain exactly: ${expected.join(", ")}`);
    }
}

function orderedPair(records, expectedKeys) {
    if (!Array.isArray(records) || records.length !== ARCHITECTURES.length) {
        throw new Error("Exactly one artifact record is required for each architecture");
    }

    const recordsByArchitecture = new Map();
    for (const record of records) {
        assertExactKeys(record, expectedKeys);
        assertArchitecture(record.arch);
        if (recordsByArchitecture.has(record.arch)) {
            throw new Error(`Duplicate artifact record for ${record.arch}`);
        }
        recordsByArchitecture.set(record.arch, record);
    }

    return ARCHITECTURES.map((arch) => {
        const record = recordsByArchitecture.get(arch);
        if (!record) {
            throw new Error(`Missing artifact record for ${arch}`);
        }
        return record;
    });
}

function validateImage(image) {
    if (typeof image !== "string" || !image || /\s|@/.test(image) || !IMAGE_PATTERN.test(image)) {
        throw new Error("Image must be a canonical image name without whitespace or a digest");
    }
}

function validateDigest(digest) {
    if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
        throw new Error("Digest must match sha256:<64 lowercase hexadecimal characters>");
    }
}

export function summariseResults(records) {
    const orderedRecords = orderedPair(records, ["arch", "e2e_passed"]);
    for (const { e2e_passed } of orderedRecords) {
        if (typeof e2e_passed !== "boolean") {
            throw new Error("e2e_passed must be a boolean");
        }
    }
    return orderedRecords.every(({ e2e_passed }) => e2e_passed);
}

export function imageReferences(image, records) {
    validateImage(image);
    const orderedRecords = orderedPair(records, ["arch", "digest"]);
    const digests = orderedRecords.map(({ digest }) => {
        validateDigest(digest);
        return digest;
    });
    if (new Set(digests).size !== digests.length) {
        throw new Error("Each architecture must have a distinct image digest");
    }
    return digests.map((digest) => `${image}@${digest}`);
}

async function writeRecord(arch, directory, record) {
    assertArchitecture(arch);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `${arch}.json`), `${JSON.stringify(record)}\n`, { flag: "wx" });
}

async function readRecords(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const jsonEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".json"));
    const expectedNames = ARCHITECTURES.map((arch) => `${arch}.json`);
    const actualNames = jsonEntries.map((entry) => entry.name).sort();
    if (actualNames.length !== expectedNames.length || expectedNames.some((name) => !actualNames.includes(name))) {
        throw new Error(`Directory must contain exactly ${expectedNames.join(" and ")}`);
    }

    return Promise.all(
        ARCHITECTURES.map(async (arch) => {
            const name = `${arch}.json`;
            const entry = jsonEntries.find((candidate) => candidate.name === name);
            if (!entry?.isFile()) {
                throw new Error(`${name} must be a regular file`);
            }
            let record;
            try {
                record = JSON.parse(await readFile(resolve(directory, name), "utf8"));
            } catch (error) {
                throw new Error(`Could not read ${name}: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (record?.arch !== arch) {
                throw new Error(`${name} must contain an ${arch} record`);
            }
            return record;
        })
    );
}

async function main(args) {
    const [command, ...values] = args;
    switch (command) {
        case "record-result": {
            if (values.length !== 3) {
                throw new Error("Usage: record-result ARCH OUTCOME DIRECTORY");
            }
            const [arch, outcome, directory] = values;
            assertArchitecture(arch);
            if (!OUTCOMES.includes(outcome)) {
                throw new Error(`Unsupported outcome: ${outcome}`);
            }
            await writeRecord(arch, directory, { arch, e2e_passed: outcome === "success" });
            return;
        }
        case "summary": {
            if (values.length !== 1) {
                throw new Error("Usage: summary DIRECTORY");
            }
            const records = await readRecords(values[0]);
            process.stdout.write(`e2e_passed=${summariseResults(records)}\n`);
            return;
        }
        case "record-digest": {
            if (values.length !== 3) {
                throw new Error("Usage: record-digest ARCH DIGEST DIRECTORY");
            }
            const [arch, digest, directory] = values;
            assertArchitecture(arch);
            validateDigest(digest);
            await writeRecord(arch, directory, { arch, digest });
            return;
        }
        case "references": {
            if (values.length !== 2) {
                throw new Error("Usage: references IMAGE DIRECTORY");
            }
            const [image, directory] = values;
            const records = await readRecords(directory);
            process.stdout.write(`${imageReferences(image, records).join("\n")}\n`);
            return;
        }
        default:
            throw new Error("Usage: cli-docker-artifacts.mjs <record-result|summary|record-digest|references> ...");
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
