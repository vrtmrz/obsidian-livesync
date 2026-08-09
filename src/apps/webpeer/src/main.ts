import { mount } from "svelte";
import "./theme.css";
import "./app.css";
import App from "./App.svelte";
import { _activeDocument } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

const app = mount(App, {
    target: _activeDocument.getElementById("app")!,
});

export default app;
