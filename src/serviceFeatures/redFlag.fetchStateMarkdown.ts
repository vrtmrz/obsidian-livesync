import MarkdownIt from "markdown-it";

export interface FetchFlagState {
    type: "livesync-fast-setup";
    version: 1;
    stage1: string;
    stage2: string;
}

const STATE_TYPE = "livesync-fast-setup";
const markdownParser = new MarkdownIt({ html: true });

type MarkdownStateBlock = {
    start: number;
    end: number;
    state: FetchFlagState | undefined;
};

function parseFetchFlagState(value: unknown): FetchFlagState | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (
        record.type !== STATE_TYPE ||
        record.version !== 1 ||
        typeof record.stage1 !== "string" ||
        typeof record.stage2 !== "string"
    ) {
        return undefined;
    }
    return {
        type: STATE_TYPE,
        version: 1,
        stage1: record.stage1,
        stage2: record.stage2,
    };
}

function getLineStartOffsets(markdown: string): number[] {
    const starts = [0];
    for (let index = 0; index < markdown.length; index++) {
        if (markdown[index] === "\r") {
            if (markdown[index + 1] === "\n") index++;
            starts.push(index + 1);
        } else if (markdown[index] === "\n") {
            starts.push(index + 1);
        }
    }
    return starts;
}

function isFenceClosed(markdown: string, map: [number, number] | null, markup: string): boolean {
    if (!map) return false;
    const closingLine = markdown.split(/\r\n|\n|\r/)[map[1] - 1] ?? "";
    const closing = /^ {0,3}(`+|~+)[\t ]*$/.exec(closingLine);
    return closing !== null && closing[1][0] === markup[0] && closing[1].length >= markup.length;
}

function getStateBlocks(markdown: string): MarkdownStateBlock[] | undefined {
    const tokens = markdownParser.parse(markdown, {});
    const topLevelFences = tokens.filter((token) => token.type === "fence" && token.level === 0);
    if (topLevelFences.some((token) => !isFenceClosed(markdown, token.map, token.markup))) return undefined;

    const starts = getLineStartOffsets(markdown);
    const blocks: MarkdownStateBlock[] = [];
    for (const token of topLevelFences) {
        if (token.info.trim() !== "json") continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(token.content);
        } catch {
            return undefined;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
        const record = parsed as Record<string, unknown>;
        if (record.type !== STATE_TYPE) continue;

        if (!token.map) return undefined;
        const start = starts[token.map[0]];
        const end = starts[token.map[1]] ?? markdown.length;
        if (start === undefined || end < start) return undefined;
        blocks.push({ start, end, state: parseFetchFlagState(parsed) });
    }
    return blocks;
}

function getLineEnding(markdown: string): string {
    return markdown.match(/\r\n|\n|\r/)?.[0] ?? "\n";
}

function formatStateBlock(state: FetchFlagState, lineEnding: string): string {
    const json = JSON.stringify(
        {
            type: state.type,
            version: state.version,
            stage1: state.stage1,
            stage2: state.stage2,
        },
        null,
        2
    );
    return `\`\`\`json${lineEnding}${json}${lineEnding}\`\`\``;
}

function createFastSetupNote(state: FetchFlagState): string {
    return [
        "# Fast Setup",
        "",
        "This file keeps the Fast Setup choices while the fetch is incomplete. It is removed when the fetch completes.",
        "",
        formatStateBlock(state, "\n"),
    ].join("\n");
}

export function readFetchFlagState(markdown: string): FetchFlagState | undefined {
    const blocks = getStateBlocks(markdown);
    if (!blocks || blocks.length !== 1) return undefined;
    return blocks[0].state;
}

export function writeFetchFlagState(markdown: string, state: FetchFlagState | undefined): string {
    if (markdown.trim().length === 0) return state ? createFastSetupNote(state) : markdown;

    const blocks = getStateBlocks(markdown);
    if (!blocks || blocks.length !== 1 || !blocks[0].state) return markdown;

    const block = blocks[0];
    const originalBlock = markdown.slice(block.start, block.end);
    const trailingLineEnding = originalBlock.match(/(?:\r\n|\n|\r)$/)?.[0] ?? "";
    const replacement = state ? formatStateBlock(state, getLineEnding(markdown)) + trailingLineEnding : "";
    return markdown.slice(0, block.start) + replacement + markdown.slice(block.end);
}
