<script lang="ts">
    import { type Diff, DIFF_DELETE, DIFF_INSERT, diff_match_patch } from "../../deps.ts";
    import type { FilePath, LoadedEntry } from "../../lib/src/common/types.ts";
    import { decodeBinary, readString } from "../../lib/src/string_and_binary/convert.ts";
    import { getDocData, mergeObject } from "../../lib/src/common/utils.ts";

    export let docs: LoadedEntry[] = [];
    export let callback: (keepRev?: string, mergedStr?: string) => Promise<void> = async (_, __) => {
        Promise.resolve();
    };
    export let filename: FilePath = "" as FilePath;
    export let nameA: string = "A";
    export let nameB: string = "B";
    export let defaultSelect: string = "";
    export let keepOrder = false;
    export let hideLocal: boolean = false;
    let docA: LoadedEntry;
    let docB: LoadedEntry;
    let docAContent = "";
    let docBContent = "";
    let objA: any = {};
    let objB: any = {};
    let objAB: any = {};
    let objBA: any = {};
    let diffs: Diff[];
    type SelectModes = "" | "A" | "B" | "AB" | "BA";
    let mode: SelectModes = defaultSelect as SelectModes;

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
    $: {
        if (docs && docs.length >= 1) {
            if (keepOrder || docs[0].mtime < docs[1].mtime) {
                docA = docs[0];
                docB = docs[1];
            } else {
                docA = docs[1];
                docB = docs[0];
            }
            docAContent = docToString(docA);
            docBContent = docToString(docB);

            try {
                objA = false;
                objB = false;
                objA = JSON.parse(docAContent);
                objB = JSON.parse(docBContent);
                objAB = mergeObject(objA, objB);
                objBA = mergeObject(objB, objA);
                if (JSON.stringify(objAB) == JSON.stringify(objBA)) {
                    objBA = false;
                }
            } catch (ex) {
                objBA = false;
                objAB = false;
            }
        }
    }
    $: mergedObjs = {
        "": false,
        A: objA,
        B: objB,
        AB: objAB,
        BA: objBA,
    };

    $: selectedObj = mode in mergedObjs ? mergedObjs[mode] : {};
    $: {
        diffs = getJsonDiff(objA, selectedObj);
    }

    let modes = [] as ["" | "A" | "B" | "AB" | "BA", string][];
    $: {
        let newModes = [] as typeof modes;

        if (!hideLocal) {
            newModes.push(["", "Not now"]);
            newModes.push(["A", nameA || "A"]);
        }
        newModes.push(["B", nameB || "B"]);
        newModes.push(["AB", `${nameA || "A"} + ${nameB || "B"}`]);
        newModes.push(["BA", `${nameB || "B"} + ${nameA || "A"}`]);
        modes = newModes;
    }
</script>

<h2>{filename}</h2>
{#if !docA || !docB}
    <div class="message">Just for a minute, please!</div>
    <div class="buttons">
        <button on:click={apply}>Dismiss</button>
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
                <span class={diff[0] == DIFF_DELETE ? "deleted" : diff[0] == DIFF_INSERT ? "added" : "normal"}>{diff[1]}</span>
            {/each}
        </div>
    {:else}
        NO PREVIEW
    {/if}

    <div class="infos">
        <table>
            <tr>
                <th>{nameA}</th>
                <td
                    >{#if docA._id == docB._id}
                        Rev:{revStringToRevNumber(docA._rev)}
                    {/if}
                    {new Date(docA.mtime).toLocaleString()}</td
                >
                <td>
                    {docAContent.length} letters
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
                    {docBContent.length} letters
                </td>
            </tr>
        </table>
    </div>

    <div class="buttons">
        {#if hideLocal}
            <button on:click={cancel}>Cancel</button>
        {/if}
        <button on:click={apply}>Apply</button>
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
    }
    .json-source {
        white-space: pre;
        height: auto;
        overflow: auto;
        min-height: var(--font-ui-medium);
        flex-grow: 1;
    }
</style>
