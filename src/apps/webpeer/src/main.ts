import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { _activeDocument } from "@lib/common/coreEnvFunctions.ts";

const app = mount(App, {
    target: _activeDocument.getElementById("app")!,
});

export default app;
