import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import * as processSetting from "@lib/API/processSetting";
import { ConnectionStringParser } from "@lib/common/ConnectionString";
import { configURIBase } from "@lib/common/models/shared.const";
import { DEFAULT_SETTINGS, REMOTE_COUCHDB, REMOTE_MINIO, REMOTE_P2P } from "@lib/common/types";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "./runCommand";
import type { CLIOptions } from "./types";
import * as commandUtils from "./utils";

function createCoreMock() {
    const liveSettings = {
        ...DEFAULT_SETTINGS,
        remoteConfigurations: {},
        activeConfigurationId: "",
        P2P_ActiveRemoteConfigurationId: "",
    } as any;
    return {
        services: {
            control: {
                activated: Promise.resolve(),
                applySettings: vi.fn(async () => {}),
            },
            setting: {
                applyExternalSettings: vi.fn(async () => {}),
                applyPartial: vi.fn(async () => {}),
                currentSettings: vi.fn(() => liveSettings),
                updateSettings: vi.fn(async (updater: any) => {
                    updater(liveSettings);
                }),
            },
            replication: {
                markResolved: vi.fn(async () => {}),
                markUnlocked: vi.fn(async () => {}),
                markLocked: vi.fn(async () => {}),
            },
            replicator: {
                getActiveReplicator: vi.fn(() => ({
                    nodeid: "test-node-id",
                    initializeDatabaseForReplication: vi.fn(async () => {}),
                    connectRemoteCouchDBWithSetting: vi.fn(async () => ({
                        db: {
                            get: vi.fn(async (id) => {
                                if (id.includes("milestone")) {
                                    return {
                                        locked: false,
                                        accepted_nodes: ["test-node-id"],
                                    };
                                }
                                throw new Error("not found");
                            }),
                        },
                    })),
                    getRemoteStatus: vi.fn(async () => ({
                        db_name: "test-db",
                        doc_count: 42,
                    })),
                })),
            },
        },
        serviceModules: {
            fileHandler: {
                dbToStorage: vi.fn(async () => true),
                storeFileToDB: vi.fn(async () => true),
            },
            storageAccess: {
                readFileAuto: vi.fn(async () => ""),
                writeFileAuto: vi.fn(async () => {}),
            },
            databaseFileAccess: {
                fetch: vi.fn(async () => undefined),
            },
        },
    } as any;
}

function makeOptions(command: CLIOptions["command"], commandArgs: string[]): CLIOptions {
    return {
        command,
        commandArgs,
        databasePath: "/tmp/vault",
        verbose: false,
        force: false,
    };
}

async function createSetupURI(passphrase: string): Promise<string> {
    const settings = {
        ...DEFAULT_SETTINGS,
        couchDB_URI: "http://127.0.0.1:5984",
        couchDB_DBNAME: "livesync-test-db",
        couchDB_USER: "user",
        couchDB_PASSWORD: "pass",
        isConfigured: true,
    } as any;
    return await processSetting.encodeSettingsToSetupURI(settings, passphrase);
}

function captureStdout() {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
        writes.push(typeof chunk === "string" ? chunk : String(chunk));
        return true;
    });
    return {
        spy,
        lines: () =>
            writes
                .join("")
                .split("\n")
                .map((e) => e.trim())
                .filter((e) => e.length > 0),
    };
}

function parseAddedRemoteIdFromLines(lines: string[]): string {
    // remote-add prints: <id>\t<name>\t<redacted-connstr>
    const last = lines.length > 0 ? lines[lines.length - 1] : "";
    return last.split("\t")[0] || "";
}

type ProtocolFixture = {
    protocol: string;
    connectionString: string;
    assertProjectedFields: (settings: any) => void;
};

const protocolFixtures: ProtocolFixture[] = [
    {
        protocol: "couchdb",
        connectionString: ConnectionStringParser.serialize({
            type: "couchdb",
            settings: {
                couchDB_URI: "https://db.example.com:5984",
                couchDB_USER: "user1",
                couchDB_PASSWORD: "pass1",
                couchDB_DBNAME: "vault1",
                couchDB_CustomHeaders: "",
                useJWT: false,
                jwtAlgorithm: "",
                jwtKey: "",
                jwtKid: "",
                jwtSub: "",
                jwtExpDuration: 5,
                useRequestAPI: false,
            },
        }),
        assertProjectedFields: (settings) => {
            expect(settings.remoteType).toBe(REMOTE_COUCHDB);
            expect(settings.couchDB_URI).toBe("https://db.example.com:5984");
            expect(settings.couchDB_USER).toBe("user1");
            expect(settings.couchDB_PASSWORD).toBe("pass1");
            expect(settings.couchDB_DBNAME).toBe("vault1");
        },
    },
    {
        protocol: "s3",
        connectionString: ConnectionStringParser.serialize({
            type: "s3",
            settings: {
                accessKey: "ak",
                secretKey: "sk",
                endpoint: "https://s3.example.com",
                bucket: "bucket-1",
                region: "ap-northeast-1",
                bucketPrefix: "vault/",
                useCustomRequestHandler: true,
                bucketCustomHeaders: "x-test:1",
                forcePathStyle: false,
            },
        }),
        assertProjectedFields: (settings) => {
            expect(settings.remoteType).toBe(REMOTE_MINIO);
            expect(settings.accessKey).toBe("ak");
            expect(settings.secretKey).toBe("sk");
            expect(settings.endpoint).toBe("https://s3.example.com");
            expect(settings.bucket).toBe("bucket-1");
            expect(settings.region).toBe("ap-northeast-1");
        },
    },
    {
        protocol: "p2p",
        connectionString: ConnectionStringParser.serialize({
            type: "p2p",
            settings: {
                P2P_Enabled: false,
                P2P_roomID: "room-abc",
                P2P_passphrase: "pass-123",
                P2P_relays: "wss://relay.example",
                P2P_AppID: "self-hosted-livesync",
                P2P_AutoStart: true,
                P2P_AutoBroadcast: false,
                P2P_turnServers: "turn:turn.example:3478",
                P2P_turnUsername: "turn-user",
                P2P_turnCredential: "turn-pass",
            },
        }),
        assertProjectedFields: (settings) => {
            expect(settings.remoteType).toBe(REMOTE_P2P);
            expect(settings.P2P_roomID).toBe("room-abc");
            expect(settings.P2P_passphrase).toBe("pass-123");
            expect(settings.P2P_relays).toBe("wss://relay.example");
            expect(settings.P2P_AppID).toBe("self-hosted-livesync");
        },
    },
];

describe("runCommand abnormal cases", () => {
    const context = {
        databasePath: "/tmp/vault",
        settingsPath: "/tmp/vault/.livesync/settings.json",
    } as any;

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("pull returns false for non-existing path", async () => {
        const core = createCoreMock();
        core.serviceModules.fileHandler.dbToStorage.mockResolvedValue(false);

        const result = await runCommand(makeOptions("pull", ["missing.md", "/tmp/out.md"]), {
            ...context,
            core,
        });

        expect(result).toBe(false);
        expect(core.serviceModules.fileHandler.dbToStorage).toHaveBeenCalled();
    });

    it("pull-rev throws on empty revision", async () => {
        const core = createCoreMock();

        await expect(
            runCommand(makeOptions("pull-rev", ["file.md", "/tmp/out.md", "   "]), {
                ...context,
                core,
            })
        ).rejects.toThrow("pull-rev requires a non-empty revision");
    });

    it("pull-rev returns false for invalid revision", async () => {
        const core = createCoreMock();
        core.serviceModules.databaseFileAccess.fetch.mockResolvedValue(undefined);

        const result = await runCommand(makeOptions("pull-rev", ["file.md", "/tmp/out.md", "9-invalid"]), {
            ...context,
            core,
        });

        expect(result).toBe(false);
        expect(core.serviceModules.databaseFileAccess.fetch).toHaveBeenCalledWith("file.md", "9-invalid", true);
    });

    it("cat-rev throws on empty revision", async () => {
        const core = createCoreMock();

        await expect(
            runCommand(makeOptions("cat-rev", ["file.md", "   "]), {
                ...context,
                core,
            })
        ).rejects.toThrow("cat-rev requires a non-empty revision");
    });

    it("cat-rev returns false for invalid revision", async () => {
        const core = createCoreMock();
        core.serviceModules.databaseFileAccess.fetch.mockResolvedValue(undefined);

        const result = await runCommand(makeOptions("cat-rev", ["file.md", "9-invalid"]), {
            ...context,
            core,
        });

        expect(result).toBe(false);
        expect(core.serviceModules.databaseFileAccess.fetch).toHaveBeenCalledWith("file.md", "9-invalid", true);
    });

    it("push rejects when source file does not exist", async () => {
        const core = createCoreMock();

        await expect(
            runCommand(makeOptions("push", ["/tmp/livesync-missing-src-file.md", "dst.md"]), {
                ...context,
                core,
            })
        ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("setup rejects invalid URI", async () => {
        const core = createCoreMock();

        await expect(
            runCommand(makeOptions("setup", ["https://invalid.example/setup"]), {
                ...context,
                core,
            })
        ).rejects.toThrow(`setup URI must start with ${configURIBase}`);
    });

    it("setup rejects empty passphrase", async () => {
        const core = createCoreMock();
        vi.spyOn(commandUtils, "promptForPassphrase").mockRejectedValue(new Error("Passphrase is required"));

        await expect(
            runCommand(makeOptions("setup", [`${configURIBase}dummy`]), {
                ...context,
                core,
            })
        ).rejects.toThrow("Passphrase is required");
    });

    it("setup accepts URI generated by encodeSettingsToSetupURI", async () => {
        const core = createCoreMock();
        const passphrase = "correct-passphrase";
        const setupURI = await createSetupURI(passphrase);
        vi.spyOn(commandUtils, "promptForPassphrase").mockResolvedValue(passphrase);

        const result = await runCommand(makeOptions("setup", [setupURI]), {
            ...context,
            core,
        });

        expect(result).toBe(true);
        expect(core.services.setting.applyExternalSettings).toHaveBeenCalledTimes(1);
        expect(core.services.control.applySettings).toHaveBeenCalledTimes(1);
        const [appliedSettings, saveImmediately] = core.services.setting.applyExternalSettings.mock.calls[0];
        expect(saveImmediately).toBe(true);
        expect(appliedSettings.couchDB_URI).toBe("http://127.0.0.1:5984");
        expect(appliedSettings.couchDB_DBNAME).toBe("livesync-test-db");
        expect(appliedSettings.isConfigured).toBe(true);
        expect(appliedSettings.useIndexedDBAdapter).toBe(false);
    });

    it("setup rejects encoded URI when passphrase is wrong", async () => {
        const core = createCoreMock();
        const setupURI = await createSetupURI("correct-passphrase");
        vi.spyOn(commandUtils, "promptForPassphrase").mockResolvedValue("wrong-passphrase");

        await expect(
            runCommand(makeOptions("setup", [setupURI]), {
                ...context,
                core,
            })
        ).rejects.toThrow();

        expect(core.services.setting.applyExternalSettings).not.toHaveBeenCalled();
        expect(core.services.control.applySettings).not.toHaveBeenCalled();
    });

    it("remote-add stores canonical URI and prints the created id", async () => {
        const core = createCoreMock();
        const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        const result = await runCommand(makeOptions("remote-add", ["my-remote", "sls+https://example.com/db"]), {
            ...context,
            core,
        });

        expect(result).toBe(true);
        const settings = core.services.setting.currentSettings();
        const ids = Object.keys(settings.remoteConfigurations);
        expect(ids.length).toBe(1);
        expect(settings.remoteConfigurations[ids[0]].name).toBe("my-remote");
        expect(settings.remoteConfigurations[ids[0]].uri).toContain("sls+https://example.com/db");
        expect(settings.activeConfigurationId).toBe(ids[0]);
        expect(stdout).toHaveBeenCalled();
    });

    it("remote-activate switches active remote and applies settings", async () => {
        const core = createCoreMock();
        const settings = core.services.setting.currentSettings();
        settings.remoteConfigurations.r1 = {
            id: "r1",
            name: "R1",
            uri: "sls+https://example.com/db1",
            isEncrypted: false,
        };
        settings.remoteConfigurations.r2 = {
            id: "r2",
            name: "R2",
            uri: "sls+https://example.com/db2",
            isEncrypted: false,
        };
        settings.activeConfigurationId = "r1";

        const result = await runCommand(makeOptions("remote-activate", ["r2"]), {
            ...context,
            core,
        });

        expect(result).toBe(true);
        expect(settings.activeConfigurationId).toBe("r2");
        expect(core.services.control.applySettings).toHaveBeenCalledTimes(1);
    });

    it("remote-rm removes active remote and promotes first remaining", async () => {
        const core = createCoreMock();
        const settings = core.services.setting.currentSettings();
        settings.remoteConfigurations.r1 = {
            id: "r1",
            name: "R1",
            uri: "sls+https://example.com/db1",
            isEncrypted: false,
        };
        settings.remoteConfigurations.r2 = {
            id: "r2",
            name: "R2",
            uri: "sls+https://example.com/db2",
            isEncrypted: false,
        };
        settings.activeConfigurationId = "r1";

        const result = await runCommand(makeOptions("remote-rm", ["r1"]), {
            ...context,
            core,
        });

        expect(result).toBe(true);
        expect(settings.remoteConfigurations.r1).toBeUndefined();
        expect(settings.activeConfigurationId).toBe("r2");
        expect(core.services.control.applySettings).toHaveBeenCalledTimes(1);
    });

    it("remote-export prints the exact stored connection string", async () => {
        const core = createCoreMock();
        const settings = core.services.setting.currentSettings();
        settings.remoteConfigurations.r1 = {
            id: "r1",
            name: "R1",
            uri: "sls+https://example.com/db?db=vault",
            isEncrypted: false,
        };
        const stdout = captureStdout();

        const result = await runCommand(makeOptions("remote-export", ["r1"]), {
            ...context,
            core,
        });

        expect(result).toBe(true);
        const outLines = stdout.lines();
        expect(outLines.length > 0 ? outLines[outLines.length - 1] : "").toBe("sls+https://example.com/db?db=vault");
        expect(stdout.spy).toHaveBeenCalled();
    });

    it("remote-set updates URI and applies settings when target is active", async () => {
        const core = createCoreMock();
        const settings = core.services.setting.currentSettings();
        settings.remoteConfigurations.r1 = {
            id: "r1",
            name: "R1",
            uri: "sls+https://old.example/db",
            isEncrypted: false,
        };
        settings.activeConfigurationId = "r1";

        const result = await runCommand(makeOptions("remote-set", ["r1", "sls+https://new.example/db"]), {
            ...context,
            core,
        });

        expect(result).toBe(true);
        expect(settings.remoteConfigurations.r1.uri).toContain("sls+https://new.example/db");
        expect(core.services.control.applySettings).toHaveBeenCalledTimes(1);
    });

    it.each(protocolFixtures)(
        "remote-activate projects effective settings for $protocol",
        async ({ connectionString, assertProjectedFields }) => {
            const core = createCoreMock();
            const settings = core.services.setting.currentSettings();
            settings.remoteConfigurations.r1 = {
                id: "r1",
                name: "R1",
                uri: "sls+https://old.example/?db=old",
                isEncrypted: false,
            };
            settings.remoteConfigurations.r2 = {
                id: "r2",
                name: "R2",
                uri: connectionString,
                isEncrypted: false,
            };
            settings.activeConfigurationId = "r1";

            const result = await runCommand(makeOptions("remote-activate", ["r2"]), {
                ...context,
                core,
            });

            expect(result).toBe(true);
            expect(settings.activeConfigurationId).toBe("r2");
            assertProjectedFields(settings);
        }
    );

    it.each(protocolFixtures)(
        "remote-set projects effective settings for active remote ($protocol)",
        async ({ connectionString, assertProjectedFields }) => {
            const core = createCoreMock();
            const settings = core.services.setting.currentSettings();
            settings.remoteConfigurations.r1 = {
                id: "r1",
                name: "R1",
                uri: "sls+https://old.example/?db=old",
                isEncrypted: false,
            };
            settings.activeConfigurationId = "r1";

            const result = await runCommand(makeOptions("remote-set", ["r1", connectionString]), {
                ...context,
                core,
            });

            expect(result).toBe(true);
            assertProjectedFields(settings);
        }
    );

    it.each(protocolFixtures)(
        "remote-rm projects promoted active remote effective settings for $protocol",
        async ({ connectionString, assertProjectedFields }) => {
            const core = createCoreMock();
            const settings = core.services.setting.currentSettings();
            settings.remoteConfigurations.r1 = {
                id: "r1",
                name: "R1",
                uri: "sls+https://old.example/?db=old",
                isEncrypted: false,
            };
            settings.remoteConfigurations.r2 = {
                id: "r2",
                name: "R2",
                uri: connectionString,
                isEncrypted: false,
            };
            settings.activeConfigurationId = "r1";

            const result = await runCommand(makeOptions("remote-rm", ["r1"]), {
                ...context,
                core,
            });

            expect(result).toBe(true);
            expect(settings.activeConfigurationId).toBe("r2");
            assertProjectedFields(settings);
        }
    );

    it.each([
        ["couchdb", "sls+https://user:pass@example.com:5984/?db=vault"] as const,
        [
            "s3",
            "sls+s3://ak:sk@example.com/?endpoint=https%3A%2F%2Fs3.example.com&bucket=my-bucket&region=ap-northeast-1",
        ] as const,
        [
            "p2p",
            "sls+p2p://room-abc?passphrase=pass-123&relays=wss%3A%2F%2Frelay.example&appId=self-hosted-livesync",
        ] as const,
    ])("remote command round-trip works for %s", async (_protocol, initialConnStr) => {
        const core = createCoreMock();

        const addOut = captureStdout();
        const addResult = await runCommand(makeOptions("remote-add", ["rt", initialConnStr]), {
            ...context,
            core,
        });
        expect(addResult).toBe(true);
        const remoteId = parseAddedRemoteIdFromLines(addOut.lines());
        expect(remoteId).not.toBe("");

        const export1Out = captureStdout();
        const export1Result = await runCommand(makeOptions("remote-export", [remoteId]), {
            ...context,
            core,
        });
        expect(export1Result).toBe(true);
        const export1Lines = export1Out.lines();
        const exported1 = export1Lines.length > 0 ? export1Lines[export1Lines.length - 1] : "";
        expect(exported1).toBe(ConnectionStringParser.serialize(ConnectionStringParser.parse(initialConnStr)));

        const roundTripInput = ConnectionStringParser.serialize(ConnectionStringParser.parse(exported1));
        const setResult = await runCommand(makeOptions("remote-set", [remoteId, roundTripInput]), {
            ...context,
            core,
        });
        expect(setResult).toBe(true);

        const export2Out = captureStdout();
        const export2Result = await runCommand(makeOptions("remote-export", [remoteId]), {
            ...context,
            core,
        });
        expect(export2Result).toBe(true);
        const export2Lines = export2Out.lines();
        const exported2 = export2Lines.length > 0 ? export2Lines[export2Lines.length - 1] : "";
        expect(exported2).toBe(roundTripInput);
    });

    describe("runCommand with decoupled vault path", () => {
        it("push resolves target path relative to vaultPath, not databasePath", async () => {
            const core = createCoreMock();
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-test-"));
            const localVaultPath = path.join(tempDir, "vault");
            const localDatabasePath = path.join(tempDir, "db");
            await fs.mkdir(localVaultPath);
            await fs.mkdir(localDatabasePath);

            const fileInVault = path.join(localVaultPath, "existing.md");
            await fs.writeFile(fileInVault, "hello", "utf-8");

            const decoupledContext = {
                databasePath: localDatabasePath,
                vaultPath: localVaultPath,
                settingsPath: path.join(localDatabasePath, ".livesync/settings.json"),
            } as any;

            const options = {
                command: "push" as const,
                commandArgs: [fileInVault, fileInVault],
                databasePath: localDatabasePath,
                vaultPath: localVaultPath,
            };

            try {
                const result = await runCommand(options, { ...decoupledContext, core });
                expect(result).toBe(true);
                expect(core.serviceModules.storageAccess.writeFileAuto).toHaveBeenCalledWith(
                    "existing.md",
                    expect.any(ArrayBuffer),
                    expect.any(Object)
                );
            } finally {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
        });
    });

    describe("mark-resolved and unlock-remote commands", () => {
        it("mark-resolved without args runs on active database", async () => {
            const core = createCoreMock();
            const result = await runCommand(makeOptions("mark-resolved", []), {
                ...context,
                core,
            });
            expect(result).toBe(true);
            expect(core.services.replication.markResolved).toHaveBeenCalledTimes(1);
            expect(core.services.control.applySettings).not.toHaveBeenCalled();
        });

        it("mark-resolved with remote-id temporarily activates it and runs markResolved", async () => {
            const core = createCoreMock();
            const settings = core.services.setting.currentSettings();
            settings.remoteConfigurations.r1 = {
                id: "r1",
                name: "R1",
                uri: "sls+https://example.com/db1",
                isEncrypted: false,
            };

            const result = await runCommand(makeOptions("mark-resolved", ["r1"]), {
                ...context,
                core,
            });
            expect(result).toBe(true);
            expect(core.services.replication.markResolved).toHaveBeenCalledTimes(1);
            expect(core.services.control.applySettings).toHaveBeenCalledTimes(1);
            expect(settings.activeConfigurationId).toBe("r1");
            expect(core.services.setting.updateSettings).toHaveBeenCalledWith(expect.any(Function), false);
        });

        it("unlock-remote without args runs on active database", async () => {
            const core = createCoreMock();
            const result = await runCommand(makeOptions("unlock-remote", []), {
                ...context,
                core,
            });
            expect(result).toBe(true);
            expect(core.services.replication.markUnlocked).toHaveBeenCalledTimes(1);
            expect(core.services.control.applySettings).not.toHaveBeenCalled();
        });

        it("unlock-remote with remote-id temporarily activates it and runs markUnlocked", async () => {
            const core = createCoreMock();
            const settings = core.services.setting.currentSettings();
            settings.remoteConfigurations.r1 = {
                id: "r1",
                name: "R1",
                uri: "sls+https://example.com/db1",
                isEncrypted: false,
            };

            const result = await runCommand(makeOptions("unlock-remote", ["r1"]), {
                ...context,
                core,
            });
            expect(result).toBe(true);
            expect(core.services.replication.markUnlocked).toHaveBeenCalledTimes(1);
            expect(core.services.control.applySettings).toHaveBeenCalledTimes(1);
            expect(settings.activeConfigurationId).toBe("r1");
            expect(core.services.setting.updateSettings).toHaveBeenCalledWith(expect.any(Function), false);
        });

        it("lock-remote without args runs on active database", async () => {
            const core = createCoreMock();
            const result = await runCommand(makeOptions("lock-remote", []), {
                ...context,
                core,
            });
            expect(result).toBe(true);
            expect(core.services.replication.markLocked).toHaveBeenCalledTimes(1);
            expect(core.services.control.applySettings).not.toHaveBeenCalled();
        });

        it("lock-remote with remote-id temporarily activates it and runs markLocked", async () => {
            const core = createCoreMock();
            const settings = core.services.setting.currentSettings();
            settings.remoteConfigurations.r1 = {
                id: "r1",
                name: "R1",
                uri: "sls+https://example.com/db1",
                isEncrypted: false,
            };

            const result = await runCommand(makeOptions("lock-remote", ["r1"]), {
                ...context,
                core,
            });
            expect(result).toBe(true);
            expect(core.services.replication.markLocked).toHaveBeenCalledTimes(1);
            expect(core.services.control.applySettings).toHaveBeenCalledTimes(1);
            expect(settings.activeConfigurationId).toBe("r1");
            expect(core.services.setting.updateSettings).toHaveBeenCalledWith(expect.any(Function), false);
        });

        it("remote-status without args outputs status of active remote configuration", async () => {
            const core = createCoreMock();
            const stdout = captureStdout();
            const result = await runCommand(makeOptions("remote-status", []), {
                ...context,
                core,
            });
            expect(result).toBe(true);
            const fullOutput = stdout.spy.mock.calls.map((c) => c[0]).join("");
            const parsedStatus = JSON.parse(fullOutput);
            expect(parsedStatus.db_name).toBe("test-db");
            expect(parsedStatus.doc_count).toBe(42);
        });

        it("remote-status with remote-id temporarily activates it and outputs status", async () => {
            const core = createCoreMock();
            const settings = core.services.setting.currentSettings();
            settings.remoteConfigurations.r1 = {
                id: "r1",
                name: "R1",
                uri: "sls+https://example.com/db1",
                isEncrypted: false,
            };
            const stdout = captureStdout();
            const result = await runCommand(makeOptions("remote-status", ["r1"]), {
                ...context,
                core,
            });
            expect(result).toBe(true);
            const fullOutput = stdout.spy.mock.calls.map((c) => c[0]).join("");
            const parsedStatus = JSON.parse(fullOutput);
            expect(parsedStatus.db_name).toBe("test-db");
            expect(parsedStatus.doc_count).toBe(42);
            expect(settings.activeConfigurationId).toBe("r1");
            expect(core.services.setting.updateSettings).toHaveBeenCalledWith(expect.any(Function), false);
        });
    });
});
