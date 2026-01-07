<script lang="ts">
    import {
        ConfigSync,
        PluginDataExDisplayV2,
        type IPluginDataExDisplay,
        type PluginDataExFile,
    } from "./CmdConfigSync.ts";
    import { Logger } from "../../lib/src/common/logger";
    import { type FilePath, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "../../lib/src/common/types";
    import { getDocData, timeDeltaToHumanReadable, unique } from "../../lib/src/common/utils";
    import type ObsidianLiveSyncPlugin from "../../main";
    // import { askString } from "../../common/utils";
    import { Menu } from "@/deps.ts";

    export let list: IPluginDataExDisplay[] = [];
    export let thisTerm = "";
    export let hideNotApplicable = false;
    export let selectNewest = 0;
    export let selectNewestStyle = 0;
    export let applyAllPluse = 0;

    export let applyData: (data: IPluginDataExDisplay) => Promise<boolean>;
    export let compareData: (
        dataA: IPluginDataExDisplay,
        dataB: IPluginDataExDisplay,
        compareEach?: boolean
    ) => Promise<boolean>;
    export let deleteData: (data: IPluginDataExDisplay) => Promise<boolean>;
    export let hidden: boolean;
    export let plugin: ObsidianLiveSyncPlugin;
    export let isMaintenanceMode: boolean = false;
    export let isFlagged: boolean = false;
    const addOn = plugin.getAddOn<ConfigSync>(ConfigSync.name)!;
    if (!addOn) {
        Logger(`Could not load the add-on ${ConfigSync.name}`, LOG_LEVEL_INFO);
        throw new Error(`Could not load the add-on ${ConfigSync.name}`);
    }

    export let selected = "";
    let freshness = "";
    let equivalency = "";
    let version = "";
    let canApply: boolean = false;
    let canCompare: boolean = false;
    let pickToCompare: boolean = false;
    let currentSelectNewest = 0;
    let currentApplyAll = 0;

    // Selectable terminals
    let terms = [] as string[];

    async function comparePlugin(local: IPluginDataExDisplay | undefined, remote: IPluginDataExDisplay | undefined) {
        let freshness = "";
        let equivalency = "";
        let version = "";
        let contentCheck = false;
        let canApply: boolean = false;
        let canCompare = false;
        if (!local && !remote) {
            // NO OP. what's happened?
            freshness = "";
        } else if (local && !remote) {
            freshness = "Local only";
        } else if (remote && !local) {
            freshness = "Remote only";
            canApply = true;
        } else {
            const dtDiff = (local?.mtime ?? 0) - (remote?.mtime ?? 0);
            const diff = timeDeltaToHumanReadable(Math.abs(dtDiff));
            if (dtDiff / 1000 < -10) {
                // freshness = "✓ Newer";
                freshness = `Newer (${diff})`;
                canApply = true;
                contentCheck = true;
            } else if (dtDiff / 1000 > 10) {
                // freshness = "⚠ Older";
                freshness = `Older (${diff})`;
                canApply = true;
                contentCheck = true;
            } else {
                freshness = "Same";
                canApply = false;
                contentCheck = true;
            }
        }
        const localVersionStr = local?.version || "0.0.0";
        const remoteVersionStr = remote?.version || "0.0.0";
        if (local?.version || remote?.version) {
            const compare = `${localVersionStr}`.localeCompare(remoteVersionStr, undefined, { numeric: true });
            if (compare == 0) {
                version = "Same";
            } else if (compare < 0) {
                version = `Lower (${localVersionStr} < ${remoteVersionStr})`;
            } else if (compare > 0) {
                version = `Higher (${localVersionStr} > ${remoteVersionStr})`;
            }
        }

        if (contentCheck) {
            if (local && remote) {
                const { canApply, equivalency, canCompare } = await checkEquivalency(local, remote);
                return { canApply, freshness, equivalency, version, canCompare };
            }
        }
        return { canApply, freshness, equivalency, version, canCompare };
    }

    async function checkEquivalency(local: IPluginDataExDisplay, remote: IPluginDataExDisplay) {
        let equivalency = "";
        let canApply = false;
        let canCompare = false;
        const filenames = [...new Set([...local.files.map((e) => e.filename), ...remote.files.map((e) => e.filename)])];
        const matchingStatus = filenames
            .map((filename) => {
                const localFile = local.files.find((e) => e.filename == filename);
                const remoteFile = remote.files.find((e) => e.filename == filename);
                if (!localFile && !remoteFile) {
                    return 0b0000000;
                } else if (localFile && !remoteFile) {
                    return 0b0000010; //"LOCAL_ONLY";
                } else if (!localFile && remoteFile) {
                    return 0b0001000; //"REMOTE ONLY"
                } else if (localFile && remoteFile) {
                    const localDoc = getDocData(localFile.data);
                    const remoteDoc = getDocData(remoteFile.data);
                    if (localDoc == remoteDoc) {
                        return 0b0000100; //"EVEN"
                    } else {
                        return 0b0010000; //"DIFFERENT";
                    }
                } else {
                    return 0b0010000; //"DIFFERENT";
                }
            })
            .reduce((p, c) => p | (c as number), 0 as number);
        if (matchingStatus == 0b0000100) {
            equivalency = "Same";
            canApply = false;
        } else if (matchingStatus <= 0b0000100) {
            equivalency = "Same or local only";
            canApply = false;
        } else if (matchingStatus == 0b0010000) {
            canApply = true;
            canCompare = true;
            equivalency = "Different";
        } else {
            canApply = true;
            canCompare = true;
            equivalency = "Mixed";
        }
        return { equivalency, canApply, canCompare };
    }

    async function performCompare(local: IPluginDataExDisplay | undefined, remote: IPluginDataExDisplay | undefined) {
        const result = await comparePlugin(local, remote);
        canApply = result.canApply;
        freshness = result.freshness;
        equivalency = result.equivalency;
        version = result.version;
        canCompare = result.canCompare;
        pickToCompare = false;
        if (canCompare) {
            if (
                local?.files.length == remote?.files.length &&
                local?.files.length == 1 &&
                local?.files[0].filename == remote?.files[0].filename
            ) {
                pickToCompare = false;
            } else {
                pickToCompare = true;
                // pickToCompare = false;
                // canCompare = false;
            }
        }
    }

    async function updateTerms(list: IPluginDataExDisplay[], selectNewest: boolean, isMaintenanceMode: boolean) {
        const local = list.find((e) => e.term == thisTerm);
        // selected = "";
        if (isMaintenanceMode) {
            terms = [...new Set(list.map((e) => e.term))];
        } else if (hideNotApplicable) {
            const termsTmp = [];
            const wk = [...new Set(list.map((e) => e.term))];
            for (const termName of wk) {
                const remote = list.find((e) => e.term == termName);
                if ((await comparePlugin(local, remote)).canApply) {
                    termsTmp.push(termName);
                }
            }
            terms = [...termsTmp];
        } else {
            terms = [...new Set(list.map((e) => e.term))].filter((e) => e != thisTerm);
        }
        let newest: IPluginDataExDisplay | undefined = local;
        if (selectNewest) {
            for (const term of terms) {
                const remote = list.find((e) => e.term == term);
                if (remote && remote.mtime && (newest?.mtime || 0) < remote.mtime) {
                    newest = remote;
                }
            }
            if (newest && newest.term != thisTerm) {
                selected = newest.term;
            }
            // selectNewest = false;
        }
        if (terms.indexOf(selected) < 0) {
            selected = "";
        }
    }
    $: {
        // React pulse and select
        let doSelectNewest = false;
        if (selectNewest != currentSelectNewest) {
            if (selectNewestStyle == 1) {
                doSelectNewest = true;
            } else if (selectNewestStyle == 2) {
                doSelectNewest = isFlagged;
            } else if (selectNewestStyle == 3) {
                selected = "";
            }
            // currentSelectNewest = selectNewest;
        }
        updateTerms(list, doSelectNewest, isMaintenanceMode);
        currentSelectNewest = selectNewest;
    }
    $: {
        // React pulse and apply
        const doApply = applyAllPluse != currentApplyAll;
        currentApplyAll = applyAllPluse;
        if (doApply && selected) {
            if (!hidden) {
                applySelected();
            }
        }
    }
    $: {
        freshness = "";
        equivalency = "";
        version = "";
        canApply = false;
        if (selected == "") {
            // NO OP.
        } else if (selected == thisTerm) {
            freshness = "This device";
            canApply = false;
        } else {
            const local = list.find((e) => e.term == thisTerm);
            const remote = list.find((e) => e.term == selected);
            performCompare(local, remote);
        }
    }
    async function applySelected() {
        const local = list.find((e) => e.term == thisTerm);
        const selectedItem = list.find((e) => e.term == selected);
        if (selectedItem && (await applyData(selectedItem))) {
            addOn.updatePluginList(true, local?.documentPath);
        }
    }
    async function compareSelected() {
        const local = list.find((e) => e.term == thisTerm);
        const selectedItem = list.find((e) => e.term == selected);
        await compareItems(local, selectedItem);
    }
    async function compareItems(
        local: IPluginDataExDisplay | undefined,
        remote: IPluginDataExDisplay | undefined,
        filename?: string
    ) {
        if (local && remote) {
            if (!filename) {
                if (await compareData(local, remote)) {
                    addOn.updatePluginList(true, local.documentPath);
                }
                return;
            } else {
                const localCopy =
                    local instanceof PluginDataExDisplayV2 ? new PluginDataExDisplayV2(local) : { ...local };
                const remoteCopy =
                    remote instanceof PluginDataExDisplayV2 ? new PluginDataExDisplayV2(remote) : { ...remote };
                localCopy.files = localCopy.files.filter((e) => e.filename == filename);
                remoteCopy.files = remoteCopy.files.filter((e) => e.filename == filename);
                if (await compareData(localCopy, remoteCopy, true)) {
                    addOn.updatePluginList(true, local.documentPath);
                }
            }
            return;
        } else {
            if (!remote && !local) {
                Logger(`Could not find both remote and local item`, LOG_LEVEL_INFO);
            } else if (!remote) {
                Logger(`Could not find remote item`, LOG_LEVEL_INFO);
            } else if (!local) {
                Logger(`Could not locally item`, LOG_LEVEL_INFO);
            }
        }
    }

    async function pickCompareItem(evt: MouseEvent) {
        const local = list.find((e) => e.term == thisTerm);
        const selectedItem = list.find((e) => e.term == selected);
        if (!local) return;
        if (!selectedItem) return;
        const menu = new Menu();
        menu.addItem((item) => item.setTitle("Compare file").setIsLabel(true));
        menu.addSeparator();
        const files = unique(local.files.map((e) => e.filename).concat(selectedItem.files.map((e) => e.filename)));
        const convDate = (dt: PluginDataExFile | undefined) => {
            if (!dt) return "(Missing)";
            const d = new Date(dt.mtime);
            return d.toLocaleString();
        };
        for (const filename of files) {
            menu.addItem((item) => {
                const localFile = local.files.find((e) => e.filename == filename);
                const remoteFile = selectedItem.files.find((e) => e.filename == filename);
                const title = `${filename} (${convDate(localFile)} <--> ${convDate(remoteFile)})`;
                item.setTitle(title).onClick((e) => compareItems(local, selectedItem, filename));
            });
        }
        menu.showAtMouseEvent(evt);
    }
    async function deleteSelected() {
        const selectedItem = list.find((e) => e.term == selected);
        // const deletedPath = selectedItem.documentPath;
        if (selectedItem && (await deleteData(selectedItem))) {
            addOn.reloadPluginList(true);
        }
    }
    async function duplicateItem() {
        const local = list.find((e) => e.term == thisTerm);
        if (!local) {
            Logger(`Could not find local item`, LOG_LEVEL_VERBOSE);
            return;
        }
        const duplicateTermName = await plugin.confirm.askString("Duplicate", "device name", "");
        if (duplicateTermName) {
            if (duplicateTermName.contains("/")) {
                Logger(`We can not use "/" to the device name`, LOG_LEVEL_NOTICE);
                return;
            }
            const key = `${plugin.app.vault.configDir}/${local.files[0].filename}`;
            await addOn.storeCustomizationFiles(key as FilePath, duplicateTermName);
            await addOn.updatePluginList(false, addOn.filenameToUnifiedKey(key, duplicateTermName));
        }
    }
</script>

{#if terms.length > 0}
    <span class="spacer"></span>
    {#if !hidden}
        <span class="chip-wrap">
            <span class="chip modified">{freshness}</span>
            <span class="chip content">{equivalency}</span>
            <span class="chip version">{version}</span>
        </span>
        <select bind:value={selected}>
            <option value={""}>-</option>
            {#each terms as term}
                <option value={term}>{term}</option>
            {/each}
        </select>
        {#if canApply || (isMaintenanceMode && selected != "")}
            {#if canCompare}
                {#if pickToCompare}
                    <button on:click={pickCompareItem}>🗃️</button>
                {:else}
                    <!--🔍  -->
                    <button on:click={compareSelected}>⮂</button>
                {/if}
            {:else}
                <!-- svelte-ignore a11y_consider_explicit_label -->
                <button disabled></button>
            {/if}
            <button on:click={applySelected}>✓</button>
        {:else}
            <!-- svelte-ignore a11y_consider_explicit_label -->
            <button disabled></button>
            <!-- svelte-ignore a11y_consider_explicit_label -->
            <button disabled></button>
        {/if}
        {#if isMaintenanceMode}
            {#if selected != ""}
                <button on:click={deleteSelected}>🗑️</button>
            {:else}
                <button on:click={duplicateItem}>📑</button>
            {/if}
        {/if}
    {/if}
{:else}
    <span class="spacer"></span>
    <span class="message even">All the same or non-existent</span>
    <!-- svelte-ignore a11y_consider_explicit_label -->
    <button disabled></button>
    <!-- svelte-ignore a11y_consider_explicit_label -->
    <button disabled></button>
{/if}

<style>
    .spacer {
        min-width: 1px;
        flex-grow: 1;
    }
    button {
        margin: 2px 4px;
        min-width: 3em;
        max-width: 4em;
    }
    button:disabled {
        border: none;
        box-shadow: none;
        background-color: transparent;
        visibility: collapse;
    }
    button:disabled:hover {
        border: none;
        box-shadow: none;
        background-color: transparent;
        visibility: collapse;
    }
    span.message {
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        padding: 0 1em;
        line-height: var(--line-height-tight);
    }
    /* span.messages {
        display: flex;
        flex-direction: column;
        align-items: center;
    } */
    :global(.is-mobile) .spacer {
        margin-left: auto;
    }

    .chip-wrap {
        display: flex;
        gap: 2px;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
    }
    .chip {
        display: inline-block;
        border-radius: 2px;
        font-size: 0.8em;
        padding: 0 4px;
        margin: 0 2px;
        border-color: var(--tag-border-color);
        background-color: var(--tag-background);
        color: var(--tag-color);
    }
    .chip:empty {
        display: none;
    }
    .chip:not(:empty)::before {
        min-width: 1.8em;
        display: inline-block;
    }
    .chip.content:not(:empty)::before {
        content: "📄: ";
    }
    .chip.version:not(:empty)::before {
        content: "🏷️: ";
    }
    .chip.modified:not(:empty)::before {
        content: "📅: ";
    }
</style>
