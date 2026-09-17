import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";

const FIELD_DELIMITER = "\u200b";
const LINE_DELIMITER = "\n";

export type PluginDataExFile = {
    filename: string;
    data: string[];
    mtime: number;
    size: number;
    version?: string;
    hash?: string;
    displayName?: string;
};

export type PluginDataEx = {
    documentPath?: FilePathWithPrefix;
    category: string;
    name: string;
    displayName?: string;
    term: string;
    files: PluginDataExFile[];
    version?: string;
    mtime: number;
};

export type CustomisationSyncCodecDependencies = {
    digestHash(data: string[]): string;
    parseYaml(source: string): unknown;
};

function splitWithDelimiters(sources: string[]): string[] {
    const result: string[] = [];
    for (const str of sources) {
        let startIndex = 0;
        const maxLen = str.length;
        let i = -1;
        let fieldIndex;
        let lineIndex;
        do {
            fieldIndex = str.indexOf(FIELD_DELIMITER, startIndex);
            lineIndex = str.indexOf(LINE_DELIMITER, startIndex);
            if (fieldIndex == -1 && lineIndex == -1) {
                break;
            }
            if (fieldIndex == -1) {
                i = lineIndex;
            } else if (lineIndex == -1) {
                i = fieldIndex;
            } else {
                i = fieldIndex < lineIndex ? fieldIndex : lineIndex;
            }
            result.push(str.slice(startIndex, i + 1));
            startIndex = i + 1;
        } while (i < maxLen);
        if (startIndex < maxLen) {
            result.push(str.slice(startIndex));
        }
    }

    // Preserve the legacy trailing-empty-chunk behaviour.
    if (sources[sources.length - 1] == "") {
        result.push("");
    }

    return result;
}

function getTokenizer(source: string[]) {
    const sources = splitWithDelimiters(source);
    sources[0] = sources[0].substring(1);
    let pos = 0;
    let lineRunOut = false;
    return {
        next(): string {
            if (lineRunOut) {
                return "";
            }
            if (pos >= sources.length) {
                return "";
            }
            const item = sources[pos];
            if (!item.endsWith(LINE_DELIMITER)) {
                pos++;
            } else {
                lineRunOut = true;
            }
            if (item.endsWith(FIELD_DELIMITER) || item.endsWith(LINE_DELIMITER)) {
                return item.substring(0, item.length - 1);
            }
            return item + this.next();
        },
        nextLine() {
            if (lineRunOut) {
                pos++;
            } else {
                while (!sources[pos].endsWith(LINE_DELIMITER)) {
                    pos++;
                    if (pos >= sources.length) break;
                }
                pos++;
            }
            lineRunOut = false;
        },
    };
}

function deserializeCustomFormat(source: string[]): PluginDataEx {
    const tokens = getTokenizer(source);
    const category = tokens.next();
    const name = tokens.next();
    const term = tokens.next();
    tokens.nextLine();
    const version = tokens.next();
    tokens.nextLine();
    const mtime = Number(tokens.next());
    tokens.nextLine();
    const result: PluginDataEx = {
        category,
        name,
        term,
        version,
        mtime,
        files: [],
    };
    let filename = "";
    do {
        filename = tokens.next();
        if (!filename) break;
        const displayName = tokens.next();
        const fileVersion = tokens.next();
        tokens.nextLine();
        const fileMtime = Number(tokens.next());
        const size = Number(tokens.next());
        const hash = tokens.next();
        tokens.nextLine();
        const data: string[] = [];
        let piece = "";
        do {
            piece = tokens.next();
            if (piece == "") break;
            data.push(piece);
        } while (piece != "");
        result.files.push({
            filename,
            displayName,
            version: fileVersion,
            mtime: fileMtime,
            size,
            data,
            hash,
        });
        tokens.nextLine();
    } while (filename);
    return result;
}

export function createCustomisationSyncCodec(dependencies: CustomisationSyncCodecDependencies) {
    function serialize(data: PluginDataEx): string {
        // Group fields with similar entropy around newlines to retain the existing chunking characteristics.
        let result = ":";
        result += data.category + FIELD_DELIMITER + data.name + FIELD_DELIMITER + data.term + LINE_DELIMITER;
        result += (data.version ?? "") + LINE_DELIMITER;
        result += data.mtime + LINE_DELIMITER;
        for (const file of data.files) {
            result +=
                file.filename +
                FIELD_DELIMITER +
                (file.displayName ?? "") +
                FIELD_DELIMITER +
                (file.version ?? "") +
                LINE_DELIMITER;
            const hash = dependencies.digestHash(file.data ?? []);
            result += file.mtime + FIELD_DELIMITER + file.size + FIELD_DELIMITER + hash + LINE_DELIMITER;
            for (const piece of file.data ?? []) {
                result += piece + FIELD_DELIMITER;
            }
            result += LINE_DELIMITER;
        }
        return result;
    }

    function deserialize<T>(source: string[], defaultValue: T): T {
        try {
            if (source[0][0] == ":") {
                return deserializeCustomFormat(source) as T;
            }
            return JSON.parse(source.join("")) as T;
        } catch {
            try {
                return dependencies.parseYaml(source.join("")) as T;
            } catch {
                return defaultValue;
            }
        }
    }

    const dummyHead = serialize({
        category: "CONFIG",
        name: "migrated",
        files: [],
        mtime: 0,
        term: "-",
        displayName: "MIRAGED",
    });
    const dummyEnd = FIELD_DELIMITER + LINE_DELIMITER + "\u200c";

    return { serialize, deserialize, dummyHead, dummyEnd };
}
