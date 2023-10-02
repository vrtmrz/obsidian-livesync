<script lang="ts">
    import type { PluginDataExDisplay } from "./CmdConfigSync";
    import { Logger } from "./lib/src/logger";
    import { versionNumberString2Number } from "./lib/src/strbin";
    import { type FilePath, LOG_LEVEL_NOTICE } from "./lib/src/types";
    import { getDocData } from "./lib/src/utils";
    import type ObsidianLiveSyncPlugin from "./main";
    import { askString, scheduleTask } from "./utils";

    export let list: PluginDataExDisplay[] = [];
    export let thisTerm = "";
    export let hideNotApplicable = false;
    export let selectNewest = 0;
    export let applyAllPluse = 0;

    export let applyData: (data: PluginDataExDisplay) => Promise<boolean>;
    export let compareData: (dataA: PluginDataExDisplay, dataB: PluginDataExDisplay) => Promise<boolean>;
    export let deleteData: (data: PluginDataExDisplay) => Promise<boolean>;
    export let hidden: boolean;
    export let plugin: ObsidianLiveSyncPlugin;
    export let isMaintenanceMode: boolean = false;
    const addOn = plugin.addOnConfigSync;

    let selected = "";
    let freshness = "";
    let equivalency = "";
    let version = "";
    let canApply: boolean = false;
    let canCompare: boolean = false;
    let currentSelectNewest = 0;
    let currentApplyAll = 0;

    // Selectable terminals
    let terms = [] as string[];

    async function comparePlugin(local: PluginDataExDisplay, remote: PluginDataExDisplay) {
        let freshness = "";
        let equivalency = "";
        let version = "";
        let contentCheck = false;
        let canApply: boolean = false;
        let canCompare = false;
        if (!local && !remote) {
            // NO OP. whats happened?
            freshness = "";
        } else if (local && !remote) {
            freshness = "⚠ Local only";
        } else if (remote && !local) {
            freshness = "✓ Remote only";
            canApply = true;
        } else {
            const dtDiff = (local?.mtime ?? 0) - (remote?.mtime ?? 0);
            if (dtDiff / 1000 < -10) {
                freshness = "✓ Newer";
                canApply = true;
                contentCheck = true;
            } else if (dtDiff / 1000 > 10) {
                freshness = "⚠ Older";
                canApply = true;
                contentCheck = true;
            } else {
                freshness = "⚖️ Same old";
                canApply = false;
                contentCheck = true;
            }
        }
        const localVersionStr = local?.version || "0.0.0";
        const remoteVersionStr = remote?.version || "0.0.0";
        if (local?.version || remote?.version) {
            const localVersion = versionNumberString2Number(localVersionStr);
            const remoteVersion = versionNumberString2Number(remoteVersionStr);
            if (localVersion == remoteVersion) {
                version = "⚖️ Same ver.";
            } else if (localVersion > remoteVersion) {
                version = `⚠ Lower ${localVersionStr} > ${remoteVersionStr}`;
            } else if (localVersion < remoteVersion) {
                version = `✓ Higher ${localVersionStr} < ${remoteVersionStr}`;
            }
        }

        if (contentCheck) {
            const { canApply, equivalency, canCompare } = await checkEquivalency(local, remote);
            return { canApply, freshness, equivalency, version, canCompare };
        }
        return { canApply, freshness, equivalency, version, canCompare };
    }

    async function checkEquivalency(local: PluginDataExDisplay, remote: PluginDataExDisplay) {
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
                } else {
                    if (getDocData(localFile.data) == getDocData(remoteFile.data)) {
                        return 0b0000100; //"EVEN"
                    } else {
                        return 0b0010000; //"DIFFERENT";
                    }
                }
            })
            .reduce((p, c) => p | (c as number), 0 as number);
        if (matchingStatus == 0b0000100) {
            equivalency = "⚖️ Same";
            canApply = false;
        } else if (matchingStatus <= 0b0000100) {
            equivalency = "Same or local only";
            canApply = false;
        } else if (matchingStatus == 0b0010000) {
            canApply = true;
            canCompare = true;
            equivalency = "≠ Different";
        } else {
            canApply = true;
            canCompare = true;
            equivalency = "≠ Different";
        }
        return { equivalency, canApply, canCompare };
    }

    async function performCompare(local: PluginDataExDisplay, remote: PluginDataExDisplay) {
        const result = await comparePlugin(local, remote);
        canApply = result.canApply;
        freshness = result.freshness;
        equivalency = result.equivalency;
        version = result.version;
        canCompare = result.canCompare;
        if (local?.files.length != 1 || !local?.files?.first()?.filename?.endsWith(".json")) {
            canCompare = false;
        }
    }

    async function updateTerms(list: PluginDataExDisplay[], selectNewest: boolean, isMaintenanceMode: boolean) {
        const local = list.find((e) => e.term == thisTerm);
        selected = "";
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
        let newest: PluginDataExDisplay = local;
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
    }
    $: {
        // React pulse and select
        const doSelectNewest = selectNewest != currentSelectNewest;
        currentSelectNewest = selectNewest;
        updateTerms(list, doSelectNewest, isMaintenanceMode);
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
            scheduleTask("update-plugin-list", 250, () => addOn.updatePluginList(true, local.documentPath));
        }
    }
    async function compareSelected() {
        const local = list.find((e) => e.term == thisTerm);
        const selectedItem = list.find((e) => e.term == selected);
        if (local && selectedItem && (await compareData(local, selectedItem))) {
            scheduleTask("update-plugin-list", 250, () => addOn.updatePluginList(true, local.documentPath));
        }
    }
    async function deleteSelected() {
        const selectedItem = list.find((e) => e.term == selected);
        // const deletedPath = selectedItem.documentPath;
        if (selectedItem && (await deleteData(selectedItem))) {
            scheduleTask("update-plugin-list", 250, () => addOn.reloadPluginList(true));
        }
    }
    async function duplicateItem() {
        const local = list.find((e) => e.term == thisTerm);
        const duplicateTermName = await askString(plugin.app, "Duplicate", "device name", "");
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
    <span class="spacer" />
    {#if !hidden}
        <span class="messages">
            <span class="message">{freshness}</span>
            <span class="message">{equivalency}</span>
            <span class="message">{version}</span>
        </span>
        <select bind:value={selected}>
            <option value={""}>-</option>
            {#each terms as term}
                <option value={term}>{term}</option>
            {/each}
        </select>
        {#if canApply || (isMaintenanceMode && selected != "")}
            {#if canCompare}
                <button on:click={compareSelected}>🔍</button>
            {:else}
                <button disabled />
            {/if}
            <button on:click={applySelected}>✓</button>
        {:else}
            <button disabled />
            <button disabled />
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
    <span class="spacer" />
    <span class="message even">All the same or non-existent</span>
    <button disabled />
    <button disabled />
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
    span.messages {
        display: flex;
        flex-direction: column;
        align-items: center;
    }
    :global(.is-mobile) .spacer {
        margin-left: auto;
    }
</style>
