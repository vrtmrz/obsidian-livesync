import { runProcess } from "./process.ts";
import { CLI_DIR, CLI_DIST } from "./cli.ts";

export type CliProcessMeasurement = {
    elapsedMs: number;
    userCpuMs: number;
    systemCpuMs: number;
    totalCpuMs: number;
    cpuToWallRatio: number;
    maxResidentSetKiB: number;
};

const MARKER = "__LIVESYNC_GNU_TIME__";

export async function runMeasuredCliOrFail(...args: string[]): Promise<CliProcessMeasurement> {
    const started = performance.now();
    let output: Awaited<ReturnType<typeof runProcess>>;
    try {
        output = await runProcess("/usr/bin/time", {
            args: ["-f", `${MARKER}%U\t%S\t%M`, process.execPath, CLI_DIST, ...args],
            cwd: CLI_DIR,
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
        });
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            throw new Error(
                "GNU /usr/bin/time is required for the compression benchmark. Use the Compose runner or install GNU time."
            );
        }
        throw error;
    }
    const elapsedMs = performance.now() - started;
    const stderr = new TextDecoder().decode(output.stderr);
    const stdout = new TextDecoder().decode(output.stdout);
    const measurementLine = stderr.split(/\r?\n/).find((line) => line.startsWith(MARKER));
    if (!output.success) {
        throw new Error(`CLI exited with code ${output.code}\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
    if (!measurementLine) {
        throw new Error(`GNU time did not emit the expected measurement marker\nstderr: ${stderr}`);
    }
    const [userSeconds, systemSeconds, maxResidentSetKiB] = measurementLine
        .slice(MARKER.length)
        .split("\t")
        .map(Number);
    if (![userSeconds, systemSeconds, maxResidentSetKiB].every(Number.isFinite)) {
        throw new Error(`Could not parse GNU time measurement: ${measurementLine}`);
    }
    const userCpuMs = userSeconds * 1000;
    const systemCpuMs = systemSeconds * 1000;
    const totalCpuMs = userCpuMs + systemCpuMs;
    return {
        elapsedMs: Number(elapsedMs.toFixed(1)),
        userCpuMs: Number(userCpuMs.toFixed(1)),
        systemCpuMs: Number(systemCpuMs.toFixed(1)),
        totalCpuMs: Number(totalCpuMs.toFixed(1)),
        cpuToWallRatio: Number((totalCpuMs / elapsedMs).toFixed(4)),
        maxResidentSetKiB,
    };
}
