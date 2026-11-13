export function isCouchDBVersionAtLeast(baseVersion: string, targetVersion: string) {
    const versionParts = `${baseVersion}.0.0.0`.split(".");
    const targetParts = targetVersion.split(".");
    for (let i = 0; i < targetParts.length; i++) {
        const result = versionParts[i].localeCompare(targetParts[i], undefined, { numeric: true });
        if (result > 0) return true;
        if (result < 0) return false;
    }
    return true;
}

export function normaliseResponseHeaderKeys<T>(headers: Record<string, T>) {
    return Object.fromEntries(
        Object.entries(headers).map((entry) => {
            entry[0] = `${entry[0]}`.toLowerCase();
            return entry;
        })
    );
}
