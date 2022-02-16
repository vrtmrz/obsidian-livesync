<script lang="ts">
    import ObsidianLiveSyncPlugin from "./main";
    import { onMount } from "svelte";
    import { DevicePluginList, PluginDataEntry } from "./types";
    import { versionNumberString2Number } from "./utils";

    type JudgeResult = "" | "NEWER" | "EVEN" | "EVEN_BUT_DIFFERENT" | "OLDER" | "REMOTE_ONLY";

    interface PluginDataEntryDisp extends PluginDataEntry {
        versionInfo: string;
        mtimeInfo: string;
        mtimeFlag: JudgeResult;
        versionFlag: JudgeResult;
    }

    export let plugin: ObsidianLiveSyncPlugin;
    let plugins: PluginDataEntry[] = [];
    let deviceAndPlugins: { [key: string]: PluginDataEntryDisp[] } = {};
    let devicePluginList: [string, PluginDataEntryDisp[]][] = [];
    let ownPlugins: DevicePluginList = null;
    let showOwnPlugins = false;
    let targetList: { [key: string]: boolean } = {};

    function saveTargetList() {
        window.localStorage.setItem("ols-plugin-targetlist", JSON.stringify(targetList));
    }

    function loadTargetList() {
        let e = window.localStorage.getItem("ols-plugin-targetlist") || "{}";
        try {
            targetList = JSON.parse(e);
        } catch (_) {
            // NO OP.
        }
    }

    function clearSelection() {
        targetList = {};
    }

    async function updateList() {
        let x = await plugin.getPluginList();
        ownPlugins = x.thisDevicePlugins;
        plugins = Object.values(x.allPlugins);
        let targetListItems = Array.from(new Set(plugins.map((e) => e.deviceVaultName + "---" + e.manifest.id)));
        let newTargetList: { [key: string]: boolean } = {};
        for (const id of targetListItems) {
            for (const tag of ["---plugin", "---setting"]) {
                newTargetList[id + tag] = id + tag in targetList && targetList[id + tag];
            }
        }
        targetList = newTargetList;
        saveTargetList();
    }

    $: {
        deviceAndPlugins = {};
        for (const p of plugins) {
            if (p.deviceVaultName == plugin.settings.deviceAndVaultName && !showOwnPlugins) {
                continue;
            }
            if (!(p.deviceVaultName in deviceAndPlugins)) {
                deviceAndPlugins[p.deviceVaultName] = [];
            }
            let dispInfo: PluginDataEntryDisp = { ...p, versionInfo: "", mtimeInfo: "", versionFlag: "", mtimeFlag: "" };
            dispInfo.versionInfo = p.manifest.version;
            let x = new Date().getTime() / 1000;
            let mtime = p.mtime / 1000;
            let diff = (x - mtime) / 60;
            if (p.mtime == 0) {
                dispInfo.mtimeInfo = `-`;
            } else if (diff < 60) {
                dispInfo.mtimeInfo = `${diff | 0} Mins ago`;
            } else if (diff < 60 * 24) {
                dispInfo.mtimeInfo = `${(diff / 60) | 0} Hours ago`;
            } else if (diff < 60 * 24 * 10) {
                dispInfo.mtimeInfo = `${(diff / (60 * 24)) | 0} Days ago`;
            } else {
                dispInfo.mtimeInfo = new Date(dispInfo.mtime).toLocaleString();
            }
            // compare with own plugin
            let id = p.manifest.id;

            if (id in ownPlugins) {
                // Which we have.
                const ownPlugin = ownPlugins[id];
                let localVer = versionNumberString2Number(ownPlugin.manifest.version);
                let pluginVer = versionNumberString2Number(p.manifest.version);
                if (localVer > pluginVer) {
                    dispInfo.versionFlag = "OLDER";
                } else if (localVer == pluginVer) {
                    if (ownPlugin.manifestJson + (ownPlugin.styleCss ?? "") + ownPlugin.mainJs != p.manifestJson + (p.styleCss ?? "") + p.mainJs) {
                        dispInfo.versionFlag = "EVEN_BUT_DIFFERENT";
                    } else {
                        dispInfo.versionFlag = "EVEN";
                    }
                } else if (localVer < pluginVer) {
                    dispInfo.versionFlag = "NEWER";
                }
                if ((ownPlugin.dataJson ?? "") == (p.dataJson ?? "")) {
                    if (ownPlugin.mtime == 0 && p.mtime == 0) {
                        dispInfo.mtimeFlag = "";
                    } else {
                        dispInfo.mtimeFlag = "EVEN";
                    }
                } else {
                    if (((ownPlugin.mtime / 1000) | 0) > ((p.mtime / 1000) | 0)) {
                        dispInfo.mtimeFlag = "OLDER";
                    } else if (((ownPlugin.mtime / 1000) | 0) == ((p.mtime / 1000) | 0)) {
                        dispInfo.mtimeFlag = "EVEN_BUT_DIFFERENT";
                    } else if (((ownPlugin.mtime / 1000) | 0) < ((p.mtime / 1000) | 0)) {
                        dispInfo.mtimeFlag = "NEWER";
                    }
                }
            } else {
                dispInfo.versionFlag = "REMOTE_ONLY";
                dispInfo.mtimeFlag = "REMOTE_ONLY";
            }

            deviceAndPlugins[p.deviceVaultName].push(dispInfo);
        }
        devicePluginList = Object.entries(deviceAndPlugins);
    }

    function getDispString(stat: JudgeResult): string {
        if (stat == "") return "";
        if (stat == "NEWER") return " (Newer)";
        if (stat == "OLDER") return " (Older)";
        if (stat == "EVEN") return " (Even)";
        if (stat == "EVEN_BUT_DIFFERENT") return " (Even but different)";
        if (stat == "REMOTE_ONLY") return " (Remote Only)";
        return "";
    }

    onMount(async () => {
        loadTargetList();
        await updateList();
    });

    function toggleShowOwnPlugins() {
        showOwnPlugins = !showOwnPlugins;
    }

    function toggleTarget(key: string) {
        targetList[key] = !targetList[key];
        saveTargetList();
    }

    function toggleAll(devicename: string) {
        for (const c in targetList) {
            if (c.startsWith(devicename)) {
                targetList[c] = true;
            }
        }
    }

    async function sweepPlugins() {
        //@ts-ignore
        await plugin.app.plugins.loadManifests();
        await plugin.sweepPlugin(true);
        updateList();
    }

    async function applyPlugins() {
        for (const c in targetList) {
            if (targetList[c] == true) {
                const [deviceAndVault, id, opt] = c.split("---");
                if (deviceAndVault in deviceAndPlugins) {
                    const entry = deviceAndPlugins[deviceAndVault].find((e) => e.manifest.id == id);
                    if (entry) {
                        if (opt == "plugin") {
                            if (entry.versionFlag != "EVEN") await plugin.applyPlugin(entry);
                        } else if (opt == "setting") {
                            if (entry.mtimeFlag != "EVEN") await plugin.applyPluginData(entry);
                        }
                    }
                }
            }
        }
        //@ts-ignore
        await plugin.app.plugins.loadManifests();
        await plugin.sweepPlugin(true);
        updateList();
    }

    async function checkUpdates() {
        await plugin.checkPluginUpdate();
    }
    async function replicateAndRefresh() {
        await plugin.replicate(true);
        updateList();
    }
</script>

<div>
    <h1>Plugins and their settings</h1>
    <div class="ols-plugins-div-buttons">
        Show own items
        <div class="checkbox-container" class:is-enabled={showOwnPlugins} on:click={toggleShowOwnPlugins} />
    </div>
    <div class="sls-plugins-wrap">
        <table class="sls-plugins-tbl">
            <tr style="position:sticky">
                <th class="sls-plugins-tbl-device-head">Name</th>
                <th class="sls-plugins-tbl-device-head">Info</th>
                <th class="sls-plugins-tbl-device-head">Target</th>
            </tr>
            {#if devicePluginList.length == 0}
                <tr>
                    <td colspan="3" class="sls-table-tail tcenter"> Retrieving... </td>
                </tr>
            {/if}
            {#each devicePluginList as [deviceName, devicePlugins]}
                <tr>
                    <th colspan="2" class="sls-plugins-tbl-device-head">{deviceName}</th>
                    <th class="sls-plugins-tbl-device-head">
                        <button class="mod-cta" on:click={() => toggleAll(deviceName)}>✔</button>
                    </th>
                </tr>
                {#each devicePlugins as plugin}
                    <tr>
                        <td class="sls-table-head">{plugin.manifest.name}</td>
                        <td class="sls-table-tail tcenter">{plugin.versionInfo}{getDispString(plugin.versionFlag)}</td>
                        <td class="sls-table-tail tcenter">
                            {#if plugin.versionFlag === "EVEN" || plugin.versionFlag === ""}
                                -
                            {:else}
                                <div class="wrapToggle">
                                    <div
                                        class="checkbox-container"
                                        class:is-enabled={targetList[plugin.deviceVaultName + "---" + plugin.manifest.id + "---plugin"]}
                                        on:click={() => toggleTarget(plugin.deviceVaultName + "---" + plugin.manifest.id + "---plugin")}
                                    />
                                </div>
                            {/if}
                        </td>
                    </tr>
                    <tr>
                        <td class="sls-table-head">Settings</td>
                        <td class="sls-table-tail tcenter">{plugin.mtimeInfo}{getDispString(plugin.mtimeFlag)}</td>
                        <td class="sls-table-tail tcenter">
                            {#if plugin.mtimeFlag === "EVEN" || plugin.mtimeFlag === ""}
                                -
                            {:else}
                                <div class="wrapToggle">
                                    <div
                                        class="checkbox-container"
                                        class:is-enabled={targetList[plugin.deviceVaultName + "---" + plugin.manifest.id + "---setting"]}
                                        on:click={() => toggleTarget(plugin.deviceVaultName + "---" + plugin.manifest.id + "---setting")}
                                    />
                                </div>
                            {/if}
                        </td>
                    </tr>
                    <tr class="divider">
                        <th colspan="3" />
                    </tr>
                {/each}
            {/each}
        </table>
    </div>
    <div class="ols-plugins-div-buttons">
        <button class="" on:click={replicateAndRefresh}>Replicate and refresh</button>
        <button class="" on:click={clearSelection}>Clear Selection</button>
    </div>

    <div class="ols-plugins-div-buttons">
        <button class="mod-cta" on:click={checkUpdates}>Check Updates</button>
        <button class="mod-cta" on:click={sweepPlugins}>Sweep installed</button>
        <button class="mod-cta" on:click={applyPlugins}>Apply all</button>
    </div>
    <!--    <div class="ols-plugins-div-buttons">-->
    <!--        <button class="mod-warning" on:click={applyPlugins}>Delete all selected</button>-->
    <!--    </div>-->
</div>

<style>
    .ols-plugins-div-buttons {
        display: flex;
        flex-direction: row;
        justify-content: flex-end;
        margin-top: 8px;
    }

    .wrapToggle {
        display: flex;
        justify-content: center;
        align-content: center;
    }
</style>
