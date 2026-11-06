import { mount, unmount } from "svelte";
import LogPane from "../../../src/modules/features/Log/LogPane.svelte";
import { logMessages } from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";
import { setGlobalLogFunction } from "octagonal-wheels/common/logger";

// Simulate ordinary INFO messages being hidden while a prior diagnostic is visible.
setGlobalLogFunction(() => undefined);
logMessages.value = ["[P2P Diag] Earlier connection failure"];
const component = mount(LogPane, { target: document.querySelector("#app")!, props: { close: () => undefined } });
document.querySelector<HTMLButtonElement>("#append")!.onclick = () => {
    logMessages.value = [...logMessages.value, "[P2P Diag] Later connection recovery"];
};
document.querySelector<HTMLButtonElement>("#unmount")!.onclick = () => {
    void unmount(component);
};
