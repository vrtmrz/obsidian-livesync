<script lang="ts">
    import { onMount } from "svelte";
    import ObsidianLiveSyncPlugin from "./main";
    import { type PluginDataExDisplay, pluginIsEnumerating, pluginList } from "./CmdConfigSync";
    import PluginCombo from "./PluginCombo.svelte";
    export let plugin: ObsidianLiveSyncPlugin;

    $: hideNotApplicable = true;
    $: thisTerm = plugin.deviceAndVaultName;

    const addOn = plugin.addOnConfigSync;

    let list: PluginDataExDisplay[] = [];

    let selectNewestPulse = 0;
    let hideEven = true;
    let loading = false;
    let applyAllPluse = 0;
    let isMaintenanceMode = false;
    async function requestUpdate() {
        await addOn.updatePluginList(true);
    }
    async function requestReload() {
        await addOn.reloadPluginList(true);
    }
    pluginList.subscribe((e) => {
        list = e;
    });
    pluginIsEnumerating.subscribe((e) => {
        loading = e;
    });
    onMount(async () => {
        requestUpdate();
    });

    function filterList(list: PluginDataExDisplay[], categories: string[]) {
        const w = list.filter((e) => categories.indexOf(e.category) !== -1);
        return w.sort((a, b) => `${a.category}-${a.name}`.localeCompare(`${b.category}-${b.name}`));
    }

    function groupBy(items: PluginDataExDisplay[], key: string) {
        let ret = {} as Record<string, PluginDataExDisplay[]>;
        for (const v of items) {
            //@ts-ignore
            const k = (key in v ? v[key] : "") as string;
            ret[k] = ret[k] || [];
            ret[k].push(v);
        }
        for (const k in ret) {
            ret[k] = ret[k].sort((a, b) => `${a.category}-${a.name}`.localeCompare(`${b.category}-${b.name}`));
        }
        const w = Object.entries(ret);
        return w.sort(([a], [b]) => `${a}`.localeCompare(`${b}`));
    }

    const displays = {
        CONFIG: "Configuration",
        THEME: "Themes",
        SNIPPET: "Snippets",
    };
    async function scanAgain() {
        await addOn.scanAllConfigFiles(true);
        await requestUpdate();
    }
    async function replicate() {
        await plugin.replicate(true);
    }
    function selectAllNewest() {
        selectNewestPulse++;
    }
    function applyAll() {
        applyAllPluse++;
    }
    async function applyData(data: PluginDataExDisplay): Promise<boolean> {
        return await addOn.applyData(data);
    }
    async function compareData(docA: PluginDataExDisplay, docB: PluginDataExDisplay): Promise<boolean> {
        return await addOn.compareUsingDisplayData(docA, docB);
    }
    async function deleteData(data: PluginDataExDisplay): Promise<boolean> {
        return await addOn.deleteData(data);
    }

    $: options = {
        thisTerm,
        hideNotApplicable,
        selectNewest: selectNewestPulse,
        applyAllPluse,
        applyData,
        compareData,
        deleteData,
        plugin,
        isMaintenanceMode,
    };
</script>

<div>
    <div>
        <h1>Customization sync</h1>
        <div class="buttons">
            <button on:click={() => scanAgain()}>Scan changes</button>
            <button on:click={() => replicate()}>Sync once</button>
            <button on:click={() => requestUpdate()}>Refresh</button>
            {#if isMaintenanceMode}
                <button on:click={() => requestReload()}>Reload</button>
            {/if}
            <button on:click={() => selectAllNewest()}>Select All Shiny</button>
        </div>
        <div class="buttons">
            <button on:click={() => applyAll()}>Apply All</button>
        </div>
    </div>
    {#if loading}
        <div>
            <span>Updating list...</span>
        </div>
    {/if}
    <div class="list">
        {#if list.length == 0}
            <div class="center">No Items.</div>
        {:else}
            {#each Object.entries(displays) as [key, label]}
                <div>
                    <h3>{label}</h3>
                    {#each groupBy(filterList(list, [key]), "name") as [name, listX]}
                        <div class="labelrow {hideEven ? 'hideeven' : ''}">
                            <div class="title">
                                {name}
                            </div>
                            <PluginCombo {...options} list={listX} hidden={false} />
                        </div>
                    {/each}
                </div>
            {/each}
            <div>
                <h3>Plugins</h3>
                {#each groupBy(filterList(list, ["PLUGIN_MAIN", "PLUGIN_DATA", "PLUGIN_ETC"]), "name") as [name, listX]}
                    <div class="labelrow {hideEven ? 'hideeven' : ''}">
                        <div class="title">
                            {name}
                        </div>
                        <PluginCombo {...options} list={listX} hidden={true} />
                    </div>
                    <div class="filerow {hideEven ? 'hideeven' : ''}">
                        <div class="filetitle">Main</div>
                        <PluginCombo {...options} list={filterList(listX, ["PLUGIN_MAIN"])} hidden={false} />
                    </div>
                    <div class="filerow {hideEven ? 'hideeven' : ''}">
                        <div class="filetitle">Data</div>
                        <PluginCombo {...options} list={filterList(listX, ["PLUGIN_DATA"])} hidden={false} />
                    </div>
                {/each}
            </div>
        {/if}
    </div>
    <div class="buttons">
        <label><span>Hide not applicable items</span><input type="checkbox" bind:checked={hideEven} /></label>
    </div>
    <div class="buttons">
        <label><span>Maintenance mode</span><input type="checkbox" bind:checked={isMaintenanceMode} /></label>
    </div>
</div>

<style>
    .labelrow {
        margin-left: 0.4em;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        border-top: 1px solid var(--background-modifier-border);
        padding: 4px;
        flex-wrap: wrap;
    }
    .filerow {
        margin-left: 1.25em;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        padding-right: 4px;
        flex-wrap: wrap;
    }
    .filerow.hideeven:has(.even),
    .labelrow.hideeven:has(.even) {
        display: none;
    }

    .title {
        color: var(--text-normal);
        font-size: var(--font-ui-medium);
        line-height: var(--line-height-tight);
        margin-right: auto;
    }
    .filetitle {
        color: var(--text-normal);
        font-size: var(--font-ui-medium);
        line-height: var(--line-height-tight);
        margin-right: auto;
    }
    .buttons {
        display: flex;
        flex-direction: row;
        justify-content: flex-end;
        margin-top: 8px;
        flex-wrap: wrap;
    }
    .buttons > button {
        margin-left: 4px;
        width: auto;
    }

    label {
        display: flex;
        justify-content: center;
        align-items: center;
    }
    label > span {
        margin-right: 0.25em;
    }
    :global(.is-mobile) .title,
    :global(.is-mobile) .filetitle {
        width: 100%;
    }

    .center {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 3em;
    }
</style>
