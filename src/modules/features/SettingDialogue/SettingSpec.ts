import { statusDisplay, type ConfigurationItem } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { SettingControl, SettingDefinitionControl } from "obsidian";
import type { AutoWireOption, OnUpdateResult } from "./SettingPane.ts";
import type { AllBooleanItemKey, AllNumericItemKey, AllStringItemKey, OnDialogSettings } from "./settingConstants.ts";

export type PersistedBooleanSettingKey = Exclude<AllBooleanItemKey, keyof OnDialogSettings>;
export type PersistedStringSettingKey = Exclude<AllStringItemKey, keyof OnDialogSettings>;
export type PersistedNumericSettingKey = Exclude<AllNumericItemKey, keyof OnDialogSettings>;
export type PersistedSettingKey = PersistedBooleanSettingKey | PersistedStringSettingKey | PersistedNumericSettingKey;

type SettingSpecBase<K extends PersistedSettingKey, C> = {
    key: K;
    control: C;
    visible?: () => boolean;
    disabled?: () => boolean;
    aliases?: string[];
};

type ToggleSettingSpec = SettingSpecBase<
    PersistedBooleanSettingKey,
    {
        type: "toggle";
        defaultValue?: boolean;
    }
>;

type NumberSettingSpec = SettingSpecBase<
    PersistedNumericSettingKey,
    {
        type: "number";
        min?: number;
        max?: number;
        allowZero?: boolean;
    }
>;

type DropdownSettingSpec = SettingSpecBase<
    PersistedStringSettingKey,
    {
        type: "dropdown";
        options: () => Record<string, string>;
    }
>;

export type SettingSpec = ToggleSettingSpec | NumberSettingSpec | DropdownSettingSpec;

/** An existing Advanced-page panel and the standard controls rendered within it. */
export type SettingSpecGroup = {
    heading: string;
    items: readonly SettingSpec[];
};

export type SettingSpecMessages = {
    valueShouldBeInRange: (range: { min?: number; max?: number }) => string;
};

type LegacySettingOptions = Pick<AutoWireOption, "onUpdate">;

export type LegacySettingBinding =
    | {
          type: "toggle";
          key: PersistedBooleanSettingKey;
          options: LegacySettingOptions & Pick<AutoWireOption, "defaultToggleValue">;
      }
    | {
          type: "number";
          key: PersistedNumericSettingKey;
          options: LegacySettingOptions & {
              clampMin?: number;
              clampMax?: number;
              acceptZero?: boolean;
          };
      }
    | {
          type: "dropdown";
          key: PersistedStringSettingKey;
          options: LegacySettingOptions & { options: Record<string, string> };
      };

export interface LegacySettingSpecRenderer {
    autoWireToggle(key: AllBooleanItemKey, options?: AutoWireOption): unknown;
    autoWireNumeric(
        key: AllNumericItemKey,
        options: AutoWireOption & { clampMin?: number; clampMax?: number; acceptZero?: boolean }
    ): unknown;
    autoWireDropDown(key: AllStringItemKey, options: AutoWireOption & { options: Record<string, string> }): unknown;
}

function isToggleSettingSpec(spec: SettingSpec): spec is ToggleSettingSpec {
    return spec.control.type === "toggle";
}

function isNumberSettingSpec(spec: SettingSpec): spec is NumberSettingSpec {
    return spec.control.type === "number";
}

function toLegacyUpdateOptions(spec: SettingSpec): LegacySettingOptions {
    if (!spec.visible && !spec.disabled) {
        return {};
    }
    return {
        onUpdate: (): OnUpdateResult => ({
            ...(spec.visible ? { visibility: spec.visible() } : {}),
            ...(spec.disabled ? { disabled: spec.disabled() } : {}),
        }),
    };
}

/** Convert a shared specification to the arguments accepted by the current AutoWire renderer. */
export function toLegacySettingBinding(spec: SettingSpec): LegacySettingBinding {
    const updateOptions = toLegacyUpdateOptions(spec);
    if (isToggleSettingSpec(spec)) {
        return {
            type: "toggle",
            key: spec.key,
            options: {
                ...updateOptions,
                ...(spec.control.defaultValue === undefined ? {} : { defaultToggleValue: spec.control.defaultValue }),
            },
        };
    }
    if (isNumberSettingSpec(spec)) {
        return {
            type: "number",
            key: spec.key,
            options: {
                ...updateOptions,
                ...(spec.control.min === undefined ? {} : { clampMin: spec.control.min }),
                ...(spec.control.max === undefined ? {} : { clampMax: spec.control.max }),
                ...(spec.control.allowZero === undefined ? {} : { acceptZero: spec.control.allowZero }),
            },
        };
    }
    return {
        type: "dropdown",
        key: spec.key,
        options: {
            ...updateOptions,
            options: spec.control.options(),
        },
    };
}

/** Render one shared specification without moving value or persistence ownership out of the settings tab. */
export function renderLegacySettingSpec(renderer: LegacySettingSpecRenderer, spec: SettingSpec): void {
    const binding = toLegacySettingBinding(spec);
    switch (binding.type) {
        case "toggle":
            renderer.autoWireToggle(binding.key, binding.options);
            return;
        case "number":
            renderer.autoWireNumeric(binding.key, binding.options);
            return;
        case "dropdown":
            renderer.autoWireDropDown(binding.key, binding.options);
    }
}

function numberIsOutOfRange(value: number, control: NumberSettingSpec["control"]) {
    if (!Number.isFinite(value)) {
        return true;
    }
    if (control.max !== undefined && value > control.max) {
        return true;
    }
    if (control.allowZero && value === 0) {
        return false;
    }
    return control.min !== undefined && value < control.min;
}

/** Check a value at the settings-tab persistence boundary against its shared control specification. */
export function isValidSettingSpecValue(spec: SettingSpec, value: unknown): boolean {
    switch (spec.control.type) {
        case "toggle":
            return typeof value === "boolean";
        case "number":
            return typeof value === "number" && !numberIsOutOfRange(value, spec.control);
        case "dropdown":
            return typeof value === "string" && Object.prototype.hasOwnProperty.call(spec.control.options(), value);
    }
}

/**
 * Convert one shared specification to a declarative Obsidian control.
 *
 * This function returns a plain object and only refers to Obsidian through erased types, so Stage B does not load or
 * activate the 1.13 runtime API. Translated metadata and validation messages are explicit inputs to keep conversion
 * side-effect free.
 */
export function toObsidianSettingDefinition(
    spec: SettingSpec,
    metadata: Pick<ConfigurationItem, "name" | "desc" | "placeHolder" | "status">,
    messages: SettingSpecMessages
): SettingDefinitionControl<PersistedSettingKey> {
    let control: SettingControl<PersistedSettingKey>;
    switch (spec.control.type) {
        case "toggle":
            control = {
                type: "toggle",
                key: spec.key,
                ...(spec.control.defaultValue === undefined ? {} : { defaultValue: spec.control.defaultValue }),
                ...(spec.disabled ? { disabled: spec.disabled } : {}),
            };
            break;
        case "number": {
            const numericControl = spec.control;
            const hasRange = numericControl.min !== undefined || numericControl.max !== undefined;
            control = {
                type: "number",
                key: spec.key,
                ...(numericControl.min === undefined
                    ? {}
                    : { min: numericControl.allowZero ? Math.min(0, numericControl.min) : numericControl.min }),
                ...(numericControl.max === undefined ? {} : { max: numericControl.max }),
                ...(metadata.placeHolder ? { placeholder: metadata.placeHolder } : {}),
                ...(hasRange
                    ? {
                          validate: (value: number) =>
                              numberIsOutOfRange(value, numericControl)
                                  ? messages.valueShouldBeInRange({
                                        min: numericControl.min,
                                        max: numericControl.max,
                                    })
                                  : undefined,
                      }
                    : {}),
                ...(spec.disabled ? { disabled: spec.disabled } : {}),
            };
            break;
        }
        case "dropdown":
            control = {
                type: "dropdown",
                key: spec.key,
                options: spec.control.options(),
                ...(spec.disabled ? { disabled: spec.disabled } : {}),
            };
            break;
    }

    return {
        name: `${metadata.name}${statusDisplay(metadata.status)}`,
        ...(metadata.desc ? { desc: metadata.desc } : {}),
        ...(spec.aliases ? { aliases: spec.aliases } : {}),
        ...(spec.visible ? { visible: spec.visible } : {}),
        control,
    };
}
