<script lang="ts">
    import ObsidianLiveSyncPlugin from "./main";
    import { onDestroy, onMount } from "svelte";
    import type { AnyEntry, FilePathWithPrefix } from "./lib/src/types";
    import { getDocData, isDocContentSame } from "./lib/src/utils";
    import { diff_match_patch } from "./deps";
    import { DocumentHistoryModal } from "./DocumentHistoryModal";
    import { isPlainText, stripAllPrefixes } from "./lib/src/path";
    import { TFile } from "./deps";
    import { arrayBufferToBase64 } from "./lib/src/strbin";
    export let plugin: ObsidianLiveSyncPlugin;

    let showDiffInfo = false;
    let showChunkCorrected = false;
    let checkStorageDiff = false;

    let range_from_epoch = Date.now() - 3600000 * 24 * 7;
    let range_to_epoch = Date.now() + 3600000 * 24 * 2;
    const timezoneOffset = new Date().getTimezoneOffset();
    let dispDateFrom = new Date(range_from_epoch - timezoneOffset).toISOString().split("T")[0];
    let dispDateTo = new Date(range_to_epoch - timezoneOffset).toISOString().split("T")[0];
    $: {
        range_from_epoch = new Date(dispDateFrom).getTime() + timezoneOffset;
        range_to_epoch = new Date(dispDateTo).getTime() + timezoneOffset;

        getHistory(showDiffInfo, showChunkCorrected, checkStorageDiff);
    }
    function mtimeToDate(mtime: number) {
        return new Date(mtime).toLocaleString();
    }

    type HistoryData = {
        id: string;
        rev: string;
        path: string;
        dirname: string;
        filename: string;
        mtime: number;
        mtimeDisp: string;
        isDeleted: boolean;
        size: number;
        changes: string;
        chunks: string;
        isPlain: boolean;
    };
    let history = [] as HistoryData[];
    let loading = false;

    async function fetchChanges(): Promise<HistoryData[]> {
        try {
            const db = plugin.localDatabase;
            let result = [] as typeof history;
            for await (const docA of db.findAllNormalDocs()) {
                if (docA.mtime < range_from_epoch) {
                    continue;
                }
                if (docA.type != "newnote" && docA.type != "plain") continue;
                const path = plugin.getPath(docA as AnyEntry);
                const isPlain = isPlainText(docA.path);
                const revs = await db.getRaw(docA._id, { revs_info: true });
                let p: string = undefined;
                const reversedRevs = revs._revs_info.reverse();
                const DIFF_DELETE = -1;

                const DIFF_EQUAL = 0;
                const DIFF_INSERT = 1;

                for (const revInfo of reversedRevs) {
                    if (revInfo.status == "available") {
                        const doc =
                            (!isPlain && showDiffInfo) || (checkStorageDiff && revInfo.rev == docA._rev)
                                ? await db.getDBEntry(path, { rev: revInfo.rev }, false, false, true)
                                : await db.getDBEntryMeta(path, { rev: revInfo.rev }, true);
                        if (doc === false) continue;
                        const rev = revInfo.rev;

                        const mtime = "mtime" in doc ? doc.mtime : 0;
                        if (range_from_epoch > mtime) {
                            continue;
                        }
                        if (range_to_epoch < mtime) {
                            continue;
                        }

                        let diffDetail = "";
                        if (showDiffInfo && !isPlain) {
                            const data = getDocData(doc.data);
                            if (p === undefined) {
                                p = data;
                            }
                            if (p != data) {
                                const dmp = new diff_match_patch();
                                const diff = dmp.diff_main(p, data);
                                dmp.diff_cleanupSemantic(diff);
                                p = data;
                                const pxinit = {
                                    [DIFF_DELETE]: 0,
                                    [DIFF_EQUAL]: 0,
                                    [DIFF_INSERT]: 0,
                                } as { [key: number]: number };
                                const px = diff.reduce((p, c) => ({ ...p, [c[0]]: (p[c[0]] ?? 0) + c[1].length }), pxinit);
                                diffDetail = `-${px[DIFF_DELETE]}, +${px[DIFF_INSERT]}`;
                            }
                        }
                        const isDeleted = doc._deleted || (doc as any)?.deleted || false;
                        if (isDeleted) {
                            diffDetail += " 🗑️";
                        }
                        if (rev == docA._rev) {
                            if (checkStorageDiff) {
                                const abs = plugin.app.vault.getAbstractFileByPath(stripAllPrefixes(plugin.getPath(docA)));
                                if (abs instanceof TFile) {
                                    let result = false;
                                    if (isPlainText(docA.path)) {
                                        const data = await plugin.app.vault.read(abs);
                                        result = isDocContentSame(data, doc.data);
                                    } else {
                                        const data = await plugin.app.vault.readBinary(abs);
                                        const dataEEncoded = await arrayBufferToBase64(data);
                                        result = isDocContentSame(dataEEncoded, doc.data);
                                    }
                                    if (result) {
                                        diffDetail += " ⚖️";
                                    } else {
                                        diffDetail += " ⚠️";
                                    }
                                }
                            }
                        }
                        const docPath = plugin.getPath(doc as AnyEntry);
                        const [filename, ...pathItems] = docPath.split("/").reverse();

                        let chunksStatus = "";
                        if (showChunkCorrected) {
                            const chunks = (doc as any)?.children ?? [];
                            const loadedChunks = await db.allDocsRaw({ keys: [...chunks] });
                            const totalCount = loadedChunks.rows.length;
                            const errorCount = loadedChunks.rows.filter((e) => "error" in e).length;
                            if (errorCount == 0) {
                                chunksStatus = `✅ ${totalCount}`;
                            } else {
                                chunksStatus = `🔎 ${errorCount} ✅ ${totalCount}`;
                            }
                        }

                        result.push({
                            id: doc._id,
                            rev: doc._rev,
                            path: docPath,
                            dirname: pathItems.reverse().join("/"),
                            filename: filename,
                            mtime: mtime,
                            mtimeDisp: mtimeToDate(mtime),
                            size: (doc as any)?.size ?? 0,
                            isDeleted: isDeleted,
                            changes: diffDetail,
                            chunks: chunksStatus,
                            isPlain: isPlain,
                        });
                    }
                }
            }

            return [...result].sort((a, b) => b.mtime - a.mtime);
        } finally {
            loading = false;
        }
    }
    async function getHistory(showDiffInfo: boolean, showChunkCorrected: boolean, checkStorageDiff: boolean) {
        loading = true;
        const newDisplay = [];
        const page = await fetchChanges();
        newDisplay.push(...page);
        history = [...newDisplay];
    }

    function nextWeek() {
        dispDateTo = new Date(range_to_epoch - timezoneOffset + 3600 * 1000 * 24 * 7).toISOString().split("T")[0];
    }
    function prevWeek() {
        dispDateFrom = new Date(range_from_epoch - timezoneOffset - 3600 * 1000 * 24 * 7).toISOString().split("T")[0];
    }

    onMount(async () => {
        await getHistory(showDiffInfo, showChunkCorrected, checkStorageDiff);
    });
    onDestroy(() => {});

    function showHistory(file: string, rev: string) {
        new DocumentHistoryModal(plugin.app, plugin, file as unknown as FilePathWithPrefix, null, rev).open();
    }
    function openFile(file: string) {
        plugin.app.workspace.openLinkText(file, file);
    }
</script>

<div class="globalhistory">
    <h1>Vault history</h1>
    <div class="control">
        <div class="row"><label for="">From:</label><input type="date" bind:value={dispDateFrom} disabled={loading} /></div>
        <div class="row"><label for="">To:</label><input type="date" bind:value={dispDateTo} disabled={loading} /></div>
        <div class="row">
            <label for="">Info:</label>
            <label><input type="checkbox" bind:checked={showDiffInfo} disabled={loading} /><span>Diff</span></label>
            <label><input type="checkbox" bind:checked={showChunkCorrected} disabled={loading} /><span>Chunks</span></label>
            <label><input type="checkbox" bind:checked={checkStorageDiff} disabled={loading} /><span>File integrity</span></label>
        </div>
    </div>
    {#if loading}
        <div class="">Gathering information...</div>
    {/if}
    <table>
        <tr>
            <th> Date </th>
            <th> Path </th>
            <th> Rev </th>
            <th> Stat </th>
            {#if showChunkCorrected}
                <th> Chunks </th>
            {/if}
        </tr>
        <tr>
            <td colspan="5" class="more">
                {#if loading}
                    <div class="" />
                {:else}
                    <div><button on:click={() => nextWeek()}>+1 week</button></div>
                {/if}
            </td>
        </tr>
        {#each history as entry}
            <tr>
                <td class="mtime">
                    {entry.mtimeDisp}
                </td>
                <td class="path">
                    <div class="filenames">
                        <span class="path">/{entry.dirname.split("/").join(`​/`)}</span>
                        <span class="filename"><a on:click={() => openFile(entry.path)}>{entry.filename}</a></span>
                    </div>
                </td>
                <td>
                    <span class="rev">
                        {#if entry.isPlain}
                            <a on:click={() => showHistory(entry.path, entry.rev)}>{entry.rev}</a>
                        {:else}
                            {entry.rev}
                        {/if}
                    </span>
                </td>
                <td>
                    {entry.changes}
                </td>
                {#if showChunkCorrected}
                    <td>
                        {entry.chunks}
                    </td>
                {/if}
            </tr>
        {/each}
        <tr>
            <td colspan="5" class="more">
                {#if loading}
                    <div class="" />
                {:else}
                    <div><button on:click={() => prevWeek()}>+1 week</button></div>
                {/if}
            </td>
        </tr>
    </table>
</div>

<style>
    * {
        box-sizing: border-box;
    }
    .globalhistory {
        margin-bottom: 2em;
    }
    table {
        width: 100%;
    }
    .more > div {
        display: flex;
    }
    .more > div > button {
        flex-grow: 1;
    }
    th {
        position: sticky;
        top: 0;
        backdrop-filter: blur(10px);
    }
    td.mtime {
        white-space: break-spaces;
    }
    td.path {
        word-break: break-word;
    }
    .row {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
    }
    .row > label {
        display: flex;
        align-items: center;
        min-width: 5em;
    }
    .row > input {
        flex-grow: 1;
    }

    .filenames {
        display: flex;
        flex-direction: column;
    }
    .filenames > .path {
        font-size: 70%;
    }
    .rev {
        text-overflow: ellipsis;
        max-width: 3em;
        display: inline-block;
        overflow: hidden;
        white-space: nowrap;
    }
</style>
