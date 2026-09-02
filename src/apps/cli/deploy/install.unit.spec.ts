import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const deploySourceDirectory = dirname(fileURLToPath(import.meta.url));
const temporaryDirectories: string[] = [];

type InstallerFixture = {
    cliDirectory: string;
    environment: NodeJS.ProcessEnv;
    homeDirectory: string;
    installerPath: string;
    npmCallLog: string;
    repositoryRoot: string;
    systemctlCallLog: string;
    vaultDirectory: string;
};

async function writeExecutable(path: string, content: string): Promise<void> {
    await writeFile(path, `${content}\n`, "utf8");
    await chmod(path, 0o755);
}

async function createInstallerFixture(serviceActive: boolean): Promise<InstallerFixture> {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "livesync-cli-installer-"));
    temporaryDirectories.push(temporaryDirectory);

    const repositoryRoot = join(temporaryDirectory, "repository");
    const cliDirectory = join(repositoryRoot, "src", "apps", "cli");
    const deployDirectory = join(cliDirectory, "deploy");
    const distDirectory = join(cliDirectory, "dist");
    const fakeBinDirectory = join(temporaryDirectory, "fake-bin");
    const homeDirectory = join(temporaryDirectory, "home");
    const vaultDirectory = join(temporaryDirectory, "vault");
    const npmCallLog = join(temporaryDirectory, "npm-calls.log");
    const systemctlCallLog = join(temporaryDirectory, "systemctl-calls.log");

    await Promise.all([
        mkdir(deployDirectory, { recursive: true }),
        mkdir(distDirectory, { recursive: true }),
        mkdir(fakeBinDirectory, { recursive: true }),
        mkdir(homeDirectory, { recursive: true }),
        mkdir(vaultDirectory, { recursive: true }),
    ]);

    await Promise.all([
        copyFile(join(deploySourceDirectory, "install.sh"), join(deployDirectory, "install.sh")),
        copyFile(join(deploySourceDirectory, "livesync-cli.service"), join(deployDirectory, "livesync-cli.service")),
        writeFile(
            join(repositoryRoot, "package.json"),
            JSON.stringify({ private: true, workspaces: ["src/apps/*"] }),
            "utf8"
        ),
        writeFile(
            join(cliDirectory, "package.json"),
            JSON.stringify({
                name: "self-hosted-livesync-cli",
                private: true,
                version: "0.0.0",
                dependencies: { "fixture-runtime-dependency": "1.0.0" },
            }),
            "utf8"
        ),
        writeFile(
            join(distDirectory, "index.cjs"),
            'const chunk = require("./chunk.cjs");\n' +
                'const dependency = require("fixture-runtime-dependency");\n' +
                "process.stdout.write(`${chunk}:${dependency}\\n`);\n",
            "utf8"
        ),
        writeFile(join(distDirectory, "chunk.cjs"), 'module.exports = "chunk-ready";\n', "utf8"),
    ]);

    await writeExecutable(
        join(fakeBinDirectory, "npm"),
        [
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            'printf \'%s|%s\\n\' "$PWD" "$*" >> "$NPM_CALL_LOG"',
            'prefix=""',
            "expect_prefix=0",
            'for argument in "$@"; do',
            '    if [[ "$expect_prefix" -eq 1 ]]; then',
            '        prefix="$argument"',
            "        expect_prefix=0",
            '    elif [[ "$argument" == "--prefix" ]]; then',
            "        expect_prefix=1",
            "    fi",
            "done",
            'if [[ -n "$prefix" ]]; then',
            '    mkdir -p "$prefix/node_modules/fixture-runtime-dependency"',
            "    printf '%s\\n' 'module.exports = \"dependency-ready\";' > \"$prefix/node_modules/fixture-runtime-dependency/index.js\"",
            "fi",
        ].join("\n")
    );
    await writeExecutable(
        join(fakeBinDirectory, "systemctl"),
        [
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            'printf \'%s\\n\' "$*" >> "$SYSTEMCTL_CALL_LOG"',
            'if [[ " $* " == *" is-active "* ]]; then',
            '    [[ "${FAKE_SYSTEMCTL_ACTIVE:-1}" == "1" ]]',
            "    exit",
            "fi",
            'if [[ " $* " == *" status "* ]]; then',
            "    printf '%s\\n' \"fixture service status\"",
            "fi",
        ].join("\n")
    );
    await writeExecutable(join(fakeBinDirectory, "sleep"), ["#!/usr/bin/env bash", "exit 0"].join("\n"));

    return {
        cliDirectory,
        environment: {
            ...process.env,
            FAKE_SYSTEMCTL_ACTIVE: serviceActive ? "1" : "0",
            HOME: homeDirectory,
            NPM_CALL_LOG: npmCallLog,
            PATH: `${fakeBinDirectory}${delimiter}${process.env.PATH ?? ""}`,
            SYSTEMCTL_CALL_LOG: systemctlCallLog,
        },
        homeDirectory,
        installerPath: join(deployDirectory, "install.sh"),
        npmCallLog,
        repositoryRoot,
        systemctlCallLog,
        vaultDirectory,
    };
}

function runInstaller(fixture: InstallerFixture) {
    return spawnSync("bash", [fixture.installerPath, "--vault", fixture.vaultDirectory], {
        encoding: "utf8",
        env: fixture.environment,
    });
}

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    );
});

describe.skipIf(process.platform === "win32")("CLI systemd installer", () => {
    it("installs a runnable CLI independently of the source repository", async () => {
        const fixture = await createInstallerFixture(true);

        const installation = runInstaller(fixture);

        expect(installation.error).toBeUndefined();
        expect(installation.status, installation.stderr).toBe(0);
        expect(installation.stdout).toContain("[Done] livesync-cli service installed and started.");

        const installedCommand = join(fixture.homeDirectory, ".local", "bin", "livesync-cli");
        const installedPayload = join(fixture.homeDirectory, ".local", "lib", "livesync-cli", "dist", "index.cjs");
        const installedUnit = join(fixture.homeDirectory, ".config", "systemd", "user", "livesync-cli.service");
        expect(await readFile(installedPayload, "utf8")).toContain('require("./chunk.cjs")');
        expect(await readFile(installedUnit, "utf8")).toContain("Type=exec");

        await rm(fixture.repositoryRoot, { recursive: true });

        const command = spawnSync(installedCommand, [], { encoding: "utf8", env: fixture.environment });
        expect(command.error).toBeUndefined();
        expect(command.status, command.stderr).toBe(0);
        expect(command.stdout).toBe("chunk-ready:dependency-ready\n");

        const npmCalls = await readFile(fixture.npmCallLog, "utf8");
        expect(npmCalls).toContain(`${fixture.repositoryRoot}|install --silent`);
        expect(npmCalls).toContain(`${fixture.cliDirectory}|run build`);
        expect(npmCalls).toMatch(/install .*--omit=dev|install --omit=dev/);

        const systemctlCalls = await readFile(fixture.systemctlCallLog, "utf8");
        expect(systemctlCalls).toContain("--user enable --now livesync-cli");
        expect(systemctlCalls).toContain("--user is-active --quiet livesync-cli");
    });

    it("does not report success when the service fails to remain active", async () => {
        const fixture = await createInstallerFixture(false);

        const installation = runInstaller(fixture);
        const combinedOutput = `${installation.stdout}\n${installation.stderr}`;

        expect(installation.error).toBeUndefined();
        expect(installation.status).not.toBe(0);
        expect(combinedOutput).toContain("service did not remain active after startup");
        expect(combinedOutput).not.toContain("[Done]");
    });
});
