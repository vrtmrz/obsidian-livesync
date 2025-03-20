<script lang="ts">
    import { type Diff, DIFF_DELETE, DIFF_INSERT, diff_match_patch } from "../../deps.ts";
    import type { FilePath, LoadedEntry } from "../../lib/src/common/types.ts";
    import { decodeBinary, readString } from "../../lib/src/string_and_binary/convert.ts";
    import { getDocData, isObjectDifferent, mergeObject } from "../../lib/src/common/utils.ts";

    interface Props {
        docs?: LoadedEntry[];
        callback?: (keepRev?: string, mergedStr?: string) => Promise<void>;
        filename?: FilePath;
        nameA?: string;
        nameB?: string;
        defaultSelect?: string;
        keepOrder?: boolean;
        hideLocal?: boolean;
    }

    let {
        docs = $bindable([]),
        callback = $bindable((async (_, __) => {
            Promise.resolve();
        }) as (keepRev?: string, mergedStr?: string) => Promise<void>),
        filename = $bindable("" as FilePath),
        nameA = $bindable("A"),
        nameB = $bindable("B"),
        defaultSelect = $bindable("" as string),
        keepOrder = $bindable(false),
        hideLocal = $bindable(false),
    }: Props = $props();
    type JSONData = Record<string | number | symbol, any> | [any];

    const docsArray = $derived.by(() => {
        if (docs && docs.length >= 1) {
            if (keepOrder || docs[0].mtime < docs[1].mtime) {
                return { a: docs[0], b: docs[1] } as const;
            } else {
                return { a: docs[1], b: docs[0] } as const;
            }
        }
        return { a: false, b: false } as const;
    });
    const docA = $derived(docsArray.a);
    const docB = $derived(docsArray.b);
    const docAContent = $derived(docA && docToString(docA));
    const docBContent = $derived(docB && docToString(docB));

    function parseJson(json: string | false) {
        if (json === false) return false;
        try {
            return JSON.parse(json) as JSONData;
        } catch (ex) {
            return false;
        }
    }
    const objA = $derived(parseJson(docAContent) || {});
    const objB = $derived(parseJson(docBContent) || {});
    const objAB = $derived(mergeObject(objA, objB));
    const objBAw = $derived(mergeObject(objB, objA));
    const objBA = $derived(isObjectDifferent(objBAw, objAB) ? objBAw : false);
    let diffs: Diff[] = $derived.by(() => (objA && selectedObj ? getJsonDiff(objA, selectedObj) : []));
    type SelectModes = "" | "A" | "B" | "AB" | "BA";
    let mode: SelectModes = $state(defaultSelect as SelectModes);

    function docToString(doc: LoadedEntry) {
        return doc.datatype == "plain" ? getDocData(doc.data) : readString(new Uint8Array(decodeBinary(doc.data)));
    }
    function revStringToRevNumber(rev?: string) {
        if (!rev) return "";
        return rev.split("-")[0];
    }

    function getDiff(left: string, right: string) {
        const dmp = new diff_match_patch();
        const mapLeft = dmp.diff_linesToChars_(left, right);
        const diffLeftSrc = dmp.diff_main(mapLeft.chars1, mapLeft.chars2, false);
        dmp.diff_charsToLines_(diffLeftSrc, mapLeft.lineArray);
        return diffLeftSrc;
    }
    function getJsonDiff(a: object, b: object) {
        return getDiff(JSON.stringify(a, null, 2), JSON.stringify(b, null, 2));
    }
    function apply() {
        if (!docA || !docB) return;
        if (docA._id == docB._id) {
            if (mode == "A") return callback(docA._rev!, undefined);
            if (mode == "B") return callback(docB._rev!, undefined);
        } else {
            if (mode == "A") return callback(undefined, docToString(docA));
            if (mode == "B") return callback(undefined, docToString(docB));
        }
        if (mode == "BA") return callback(undefined, JSON.stringify(objBA, null, 2));
        if (mode == "AB") return callback(undefined, JSON.stringify(objAB, null, 2));
        callback(undefined, undefined);
    }
    function cancel() {
        callback(undefined, undefined);
    }
    const mergedObjs = $derived.by(
        () =>
            ({
                "": false,
                A: objA,
                B: objB,
                AB: objAB,
                BA: objBA,
            }) as Record<SelectModes, JSONData | false>
    );

    let selectedObj = $derived(mode in mergedObjs ? mergedObjs[mode] : {});

    let modesSrc = $state([] as ["" | "A" | "B" | "AB" | "BA", string][]);

    const modes = $derived.by(() => {
        let newModes = [] as typeof modesSrc;

        if (!hideLocal) {
            newModes.push(["", "Not now"]);
            newModes.push(["A", nameA || "A"]);
        }
        newModes.push(["B", nameB || "B"]);
        newModes.push(["AB", `${nameA || "A"} + ${nameB || "B"}`]);
        newModes.push(["BA", `${nameB || "B"} + ${nameA || "A"}`]);
        return newModes;
    });
</script>

<h2>{filename}</h2>
{#if !docA || !docB}
    <div class="message">Just for a minute, please!</div>
    <div class="buttons">
        <button onclick={apply}>Dismiss</button>
    </div>
{:else}
    <div class="options">
        {#each modes as m}
            {#if m[0] == "" || mergedObjs[m[0]] != false}
                <label class={`sls-setting-label ${m[0] == mode ? "selected" : ""}`}
                    ><input type="radio" name="disp" bind:group={mode} value={m[0]} class="sls-setting-tab" />
                    <div class="sls-setting-menu-btn">{m[1]}</div></label
                >
            {/if}
        {/each}
    </div>

    {#if selectedObj != false}
        <div class="op-scrollable json-source">
            {#each diffs as diff}
                <span class={diff[0] == DIFF_DELETE ? "deleted" : diff[0] == DIFF_INSERT ? "added" : "normal"}
                    >{diff[1]}</span
                >
            {/each}
        </div>
    {:else}
        NO PREVIEW
    {/if}

    <div class="infos">
        <table>
            <tbody>
                <tr>
                    <th>{nameA}</th>
                    <td
                        >{#if docA._id == docB._id}
                            Rev:{revStringToRevNumber(docA._rev)}
                        {/if}
                        {new Date(docA.mtime).toLocaleString()}</td
                    >
                    <td>
                        {docAContent && docAContent.length} letters
                    </td>
                </tr>
                <tr>
                    <th>{nameB}</th>
                    <td
                        >{#if docA._id == docB._id}
                            Rev:{revStringToRevNumber(docB._rev)}
                        {/if}
                        {new Date(docB.mtime).toLocaleString()}</td
                    >
                    <td>
                        {docBContent && docBContent.length} letters
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="buttons">
        {#if hideLocal}
            <button onclick={cancel}>Cancel</button>
        {/if}
        <button onclick={apply}>Apply</button>
    </div>
{/if}

<style>
    .spacer {
        flex-grow: 1;
    }
    .infos {
        display: flex;
        justify-content: space-between;
        margin: 4px 0.5em;
    }

    .deleted {
        text-decoration: line-through;
    }
    * {
        box-sizing: border-box;
    }

    .scroller {
        display: flex;
        flex-direction: column;
        overflow-y: scroll;
        max-height: 60vh;
        user-select: text;
        -webkit-user-select: text;
    }
    .json-source {
        white-space: pre;
        height: auto;
        overflow: auto;
        min-height: var(--font-ui-medium);
        flex-grow: 1;
    }
</style>
