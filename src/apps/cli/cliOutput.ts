import type { StandardIo } from "@vrtmrz/livesync-commonlib/context";

/** Report a CLI-owned diagnostic without selecting its final presentation channel. */
export type CliDiagnosticReporter = (message: string, detail?: unknown) => void;

function formatValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack ?? value.message;
    try {
        const encoded = JSON.stringify(value);
        if (encoded !== undefined) return encoded;
    } catch {
        // Fall through to the host-independent string conversion.
    }
    return String(value);
}

function formatLine(values: readonly unknown[]): string {
    return `${values.map(formatValue).join(" ")}\n`;
}

/** Render one user-facing line on standard output. */
export function writeStdoutLine(standardIo: StandardIo, ...values: readonly unknown[]): void {
    standardIo.writeStdout(formatLine(values));
}

/** Render one user-facing or diagnostic line on standard error. */
export function writeStderrLine(standardIo: StandardIo, ...values: readonly unknown[]): void {
    standardIo.writeStderr(formatLine(values));
}
