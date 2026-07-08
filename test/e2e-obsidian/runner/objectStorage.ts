import {
    CreateBucketCommand,
    DeleteObjectsCommand,
    ListObjectsV2Command,
    S3Client,
    type _Object,
} from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type ObjectStorageConfig = {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    region: string;
    forcePathStyle: boolean;
};

function parseEnvFile(content: string): Record<string, string> {
    const entries = content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
            const equalsAt = line.indexOf("=");
            if (equalsAt < 0) {
                return undefined;
            }
            const key = line.slice(0, equalsAt).trim();
            const rawValue = line.slice(equalsAt + 1).trim();
            const value = rawValue.replace(/^['"]|['"]$/gu, "");
            return [key, value] as const;
        })
        .filter((entry): entry is readonly [string, string] => entry !== undefined);
    return Object.fromEntries(entries);
}

function getEnvValue(values: Record<string, string | undefined>, ...keys: string[]): string {
    for (const key of keys) {
        const value = values[key]?.trim();
        if (value) {
            return value;
        }
    }
    throw new Error(`Required Object Storage environment value is missing: ${keys.join(" or ")}`);
}

export async function loadObjectStorageConfig(envFile = ".test.env"): Promise<ObjectStorageConfig> {
    let fileValues: Record<string, string> = {};
    try {
        fileValues = parseEnvFile(await readFile(resolve(envFile), "utf-8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
        }
    }

    const values = { ...fileValues, ...process.env };
    return {
        endpoint: getEnvValue(values, "MINIO_ENDPOINT", "minioEndpoint").replace(/\/+$/u, ""),
        accessKey: getEnvValue(values, "MINIO_ACCESS_KEY", "accessKey"),
        secretKey: getEnvValue(values, "MINIO_SECRET_KEY", "secretKey"),
        bucket: getEnvValue(values, "MINIO_BUCKET", "bucketName"),
        region: values.MINIO_REGION?.trim() || values.region?.trim() || "us-east-1",
        forcePathStyle: values.MINIO_FORCE_PATH_STYLE?.trim() !== "false",
    };
}

export function makeUniqueBucketPrefix(label: string): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `obsidian-e2e/${label}-${Date.now()}-${random}/`;
}

export function createObjectStorageClient(config: ObjectStorageConfig): S3Client {
    return new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: {
            accessKeyId: config.accessKey,
            secretAccessKey: config.secretKey,
        },
    });
}

export async function ensureObjectStorageBucket(config: ObjectStorageConfig): Promise<void> {
    const client = createObjectStorageClient(config);
    try {
        await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
    } catch (error) {
        const name = (error as { name?: string }).name;
        if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
            throw error;
        }
    } finally {
        client.destroy();
    }
}

export async function listObjectStorageObjects(config: ObjectStorageConfig, prefix: string): Promise<_Object[]> {
    const client = createObjectStorageClient(config);
    try {
        const objects: _Object[] = [];
        let continuationToken: string | undefined;
        do {
            const response = await client.send(
                new ListObjectsV2Command({
                    Bucket: config.bucket,
                    Prefix: prefix,
                    ContinuationToken: continuationToken,
                })
            );
            objects.push(...(response.Contents ?? []));
            continuationToken = response.NextContinuationToken;
        } while (continuationToken);
        return objects;
    } finally {
        client.destroy();
    }
}

export async function deleteObjectStoragePrefix(config: ObjectStorageConfig, prefix: string): Promise<void> {
    const client = createObjectStorageClient(config);
    try {
        const objects = await listObjectStorageObjects(config, prefix);
        const keys = objects.flatMap((object) => (object.Key ? [{ Key: object.Key }] : []));
        for (let index = 0; index < keys.length; index += 1000) {
            await client.send(
                new DeleteObjectsCommand({
                    Bucket: config.bucket,
                    Delete: {
                        Objects: keys.slice(index, index + 1000),
                        Quiet: true,
                    },
                })
            );
        }
    } finally {
        client.destroy();
    }
}
