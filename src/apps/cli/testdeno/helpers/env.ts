/**
 * Load a .env-style file (KEY=value per line) into a plain object.
 * Equivalent to `source $TEST_ENV_FILE; set -a` in bash.
 * Maybe we should use some library... now it is just the minimal implementation that covers our use cases.
 *
 * Supported value formats:
 *   KEY=value
 *   KEY='single quoted'
 *   KEY="double quoted"
 *   # comment lines are ignored
  */
export async function loadEnvFile(filePath: string): Promise<Record<string, string>> {
    const text = await Deno.readTextFile(filePath);
    const result: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx < 0) continue;
        const key = trimmed.slice(0, idx).trim();
        const raw = trimmed.slice(idx + 1).trim();
        // Strip surrounding single or double quotes
        result[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
    }
    return result;
}
