import { _activeDocument } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { mount } from "svelte";

import P2PCheck from "./P2PCheck.svelte";
import "./check.css";

const app = mount(P2PCheck, {
    target: _activeDocument.getElementById("app")!,
});

export default app;
