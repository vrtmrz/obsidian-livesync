function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function objectToDotted(obj: unknown, prefix = ""): Record<string, unknown> {
    if (!isRecord(obj)) {
        throw new TypeError("Expected a message catalogue object");
    }
    const flattened: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        if (isRecord(value)) {
            Object.assign(flattened, objectToDotted(value, newKey));
        } else {
            flattened[newKey] = value;
        }
    }
    return flattened;
}

export function dottedToObject(obj: unknown): Record<string, unknown> {
    if (!isRecord(obj)) {
        throw new TypeError("Expected a dotted message catalogue object");
    }
    const nestedResult: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (key.includes(" ")) {
            nestedResult[key] = value;
            continue;
        }
        const keys = key.split(".");
        let nested = nestedResult;
        for (const [index, currentKey] of keys.entries()) {
            if (index === keys.length - 1) {
                nested[currentKey] = value;
                continue;
            }
            const currentValue = nested[currentKey];
            if (isRecord(currentValue)) {
                nested = currentValue;
                continue;
            }
            const replacement = currentValue === undefined || currentValue === null ? {} : { _value: currentValue };
            nested[currentKey] = replacement;
            nested = replacement;
        }
    }
    return nestedResult;
}
