import { mount } from "svelte";
import "./app.css";
import App from "./UITest.svelte";
import { _activeDocument } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

const app = mount(App, {
    target: _activeDocument.getElementById("app")!,
});

export default app;
