// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type FilePath } from "@lib/common/types.ts";
export { addIcon, App, debounce, Editor, FuzzySuggestModal, MarkdownRenderer, MarkdownView, Modal, Notice, Platform, Plugin, PluginSettingTab, requestUrl, sanitizeHTMLToDom, Setting, stringifyYaml, TAbstractFile, TextAreaComponent, TFile, TFolder, parseYaml, ItemView, WorkspaceLeaf, Menu, request, getLanguage, ButtonComponent, TextComponent, ToggleComponent, DropdownComponent, Component, } from "obsidian";
export type { DataWriteOptions, PluginManifest, RequestUrlParam, RequestUrlResponse, MarkdownFileInfo, ListedFiles, ValueComponent, Stat, Command, ViewCreator, } from "obsidian";
declare const normalizePath: <T extends string | FilePath>(from: T) => T;
export { normalizePath };
export { type Diff, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from "diff-match-patch";
