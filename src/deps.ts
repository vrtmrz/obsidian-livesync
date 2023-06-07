import { type FilePath } from "./lib/src/types";

export {
    addIcon, App, debounce, Editor, FuzzySuggestModal, MarkdownRenderer, MarkdownView, Modal, Notice, Platform, Plugin, PluginSettingTab, Plugin_2, requestUrl, sanitizeHTMLToDom, Setting, stringifyYaml, TAbstractFile, TextAreaComponent, TFile, TFolder,
    parseYaml, ItemView, WorkspaceLeaf
} from "obsidian";
export type { DataWriteOptions, PluginManifest, RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
    normalizePath as normalizePath_
} from "obsidian";
const normalizePath = normalizePath_ as <T extends string | FilePath>(from: T) => T;
export { normalizePath }
