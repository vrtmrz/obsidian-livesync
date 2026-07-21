export function objectToDotted(obj: any, prefix = ""): Record<string, any> {
    return Object.entries(obj).reduce(
        (acc, [key, value]) => {
            const newKey = prefix ? `${prefix}.${key}` : key;
            if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                Object.assign(acc, objectToDotted(value, newKey));
            } else {
                acc[newKey] = value;
            }
            return acc;
        },
        {} as Record<string, any>
    );
}
export function dottedToObject(obj: Record<string, any>): Record<string, any> {
    return Object.entries(obj).reduce(
        (acc, [key, value]) => {
            if (key.includes(" ")) {
                // Return as is.
                return { ...acc, [key]: value }; // Skip keys with spaces
            }
            const keys = key.split(".");
            keys.reduce((nestedAcc, currKey, index) => {
                if (currKey in nestedAcc && typeof nestedAcc[currKey] !== "object") {
                    nestedAcc[currKey] = { _value: nestedAcc[currKey] }; // Convert to object if not already
                }
                if (index === keys.length - 1) {
                    nestedAcc[currKey] = value;
                } else {
                    nestedAcc[currKey] = nestedAcc[currKey] || {};
                }
                return nestedAcc[currKey];
            }, acc);
            return acc;
        },
        {} as Record<string, any>
    );
}
