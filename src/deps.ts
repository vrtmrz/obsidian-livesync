import { FilePath } from "./lib/src/types";

export {
    addIcon, App, DataWriteOptions, debounce, Editor, FuzzySuggestModal, MarkdownRenderer, MarkdownView, Modal, Notice, Platform, Plugin, PluginManifest,
    PluginSettingTab, Plugin_2, requestUrl, RequestUrlParam, RequestUrlResponse, sanitizeHTMLToDom, Setting, stringifyYaml, TAbstractFile, TextAreaComponent, TFile, TFolder,
} from "obsidian";
import {
    normalizePath as normalizePath_
} from "obsidian";
const normalizePath = normalizePath_ as <T extends string | FilePath>(from: T) => T;
export { normalizePath }
