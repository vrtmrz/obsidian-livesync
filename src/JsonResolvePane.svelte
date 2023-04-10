<script lang="ts">
    import { Diff, DIFF_DELETE, DIFF_INSERT, diff_match_patch } from "diff-match-patch";
    import type { FilePath, LoadedEntry } from "./lib/src/types";
    import { base64ToString } from "./lib/src/strbin";
    import { getDocData } from "./lib/src/utils";
    import { mergeObject } from "./utils";

    export let docs: LoadedEntry[] = [];
    export let callback: (keepRev: string, mergedStr?: string) => Promise<void> = async (_, __) => {
        Promise.resolve();
    };
    export let filename: FilePath = "" as FilePath;

    let docA: LoadedEntry = undefined;
    let docB: LoadedEntry = undefined;
    let docAContent = "";
    let docBContent = "";
    let objA: any = {};
    let objB: any = {};
    let objAB: any = {};
    let objBA: any = {};
    let diffs: Diff[];
    const modes = [
        ["", "Not now"],
        ["A", "A"],
        ["B", "B"],
        ["AB", "A + B"],
        ["BA", "B + A"],
    ] as ["" | "A" | "B" | "AB" | "BA", string][];
    let mode: "" | "A" | "B" | "AB" | "BA" = "";

    function docToString(doc: LoadedEntry) {
        return doc.datatype == "plain" ? getDocData(doc.data) : base64ToString(doc.data);
    }
    function revStringToRevNumber(rev: string) {
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
        if (mode == "A") return callback(docA._rev, null);
        if (mode == "B") return callback(docB._rev, null);
        if (mode == "BA") return callback(null, JSON.stringify(objBA, null, 2));
        if (mode == "AB") return callback(null, JSON.stringify(objAB, null, 2));
        callback(null, null);
    }
    $: {
        if (docs && docs.length >= 1) {
            if (docs[0].mtime < docs[1].mtime) {
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
        console.dir(selectedObj);
    }
</script>

<h1>Conflicted settings</h1>
<div><span>{filename}</span></div>
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
    <div>
        A Rev:{revStringToRevNumber(docA._rev)} ,{new Date(docA.mtime).toLocaleString()}
        {docAContent.length} letters
    </div>

    <div>
        B Rev:{revStringToRevNumber(docB._rev)} ,{new Date(docB.mtime).toLocaleString()}
        {docBContent.length} letters
    </div>

    <div class="buttons">
        <button on:click={apply}>Apply</button>
    </div>
{/if}

<style>
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
