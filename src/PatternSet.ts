import { Setting } from "obsidian";

// Pattern Grammar:
type RegexPattern = { regex: string };
type GlobPattern = { glob: string };

type ValidPattern = RegexPattern | GlobPattern;
type InvalidPattern = { invalid: ValidPattern }

export type Pattern = ValidPattern | InvalidPattern;

// Constants:
const REGEX_ESCAPE_METACHARS = /[.*+?^${}()|[\]\\]/g;
const PATH_SEPARATOR = '/';

/**
 * An ordered set of file-matching patterns.
 */
export class PatternSet {
    private rawPatterns: Pattern[];
    private compiledPatterns: (RegExp|InvalidPattern)[];

    public constructor(rawPatterns: Pattern[]) {
        this.rawPatterns = rawPatterns.slice();
        this.compiledPatterns = rawPatterns.map(compilePattern);
    }

    /**
     * Adds a pattern to the set.
     * @param pattern The pattern to add.
     */
    public add(pattern: Pattern): void {
        if (this.findIndex(pattern) !== undefined) {
            return;
        }

        this.compiledPatterns.push(compilePattern(pattern));
        this.rawPatterns.push(pattern);
    }

    /**
     * Removes a pattern from the set.
     * @param pattern The pattern to remove.
     */
    public remove(pattern: Pattern) {
        const index = this.findIndex(pattern);
        if (index === undefined) {
            return;
        }

        this.rawPatterns.splice(index, 1);
        this.compiledPatterns.splice(index, 1);
    }

    /**
     * Replaces a pattern from the set with another pattern, maintaining the order.
     * @param original The pattern to replace.
     * @param withPattern The new pattern.
     * @returns True if the pattern was replaced.
     */
    public replace(original: Pattern, withPattern: Pattern): boolean {
        const index = this.findIndex(original);
        if (index === undefined) {
            return false;
        }

        this.compiledPatterns[index] = compilePattern(withPattern);
        this.rawPatterns[index] = withPattern;
        return true;
    }

    /**
     * Checks if a pattern is in the set.
     * @param pattern The pattern to check.
     */
    public has(pattern: Pattern) {
        return this.findIndex(pattern) !== undefined;
    }

    /**
     * Returns all the patterns in the set.
     */
    public entries(): Pattern[] {
        return this.rawPatterns.map(clonePattern);
    }

    /**
     * Removes all entries from the pattern set.
     */
    public clear() {
        this.rawPatterns = [];
        this.compiledPatterns = [];
    }

    /**
     * Checks to see if a string matches any of the patterns in this set.
     * @param str The string to check.
     * @returns True if matched, false otherwise.
     */
    public isMatched(str: string): boolean {
        for (const pattern of this.compiledPatterns) {
            if (pattern instanceof RegExp && pattern.test(str)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Clones the pattern set.
     */
    public clone(): PatternSet {
        return Object.assign(
            Object.create(Object.getPrototypeOf(this)),
            {
                rawPatterns: this.entries(),
                compilePatterns: this.compiledPatterns.slice(),
            }
        )
    }

    private findIndex(pattern: Pattern): number | undefined {
        for (let i = 0; i < this.rawPatterns.length; i++) {
            const patternInSet = this.rawPatterns[i] as (RegexPattern & GlobPattern);
            if (
                (pattern as GlobPattern).glob === patternInSet.glob &&
                (pattern as RegexPattern).regex === patternInSet.regex) {
                return i;
            }
        }

        return undefined;
    }
}

/**
 * Compiles a {@link Pattern} into a regular expression.
 * This will directly compile regular expression patterns, and convert globs to regex.
 *
 * @param pattern The pattern to compile.
 * @returns The compiled pattern, or an {@link InvalidPattern} if the pattern is not valid.
 */
export function compilePattern(pattern: Pattern): RegExp|InvalidPattern {
    if ('invalid' in pattern) return pattern;
    if ('glob' in pattern && 'regex' in pattern) {
        return { invalid: pattern };
    }

    // Pattern is regex.
    if ('regex' in pattern) {
        try {
            return new RegExp(pattern.regex);
        } catch (ex) {
            return {invalid: pattern};
        }
    }

    // Pattern is glob.
    //   '*'     => matches non-directories
    //   '**'    => matches anything
    //   '{a,b}' => matches either 'a' or 'b'
    if ('glob' in pattern) {
        const globAsRegex = pattern.glob
            .replace(REGEX_ESCAPE_METACHARS, "\\$&")  // Escape regex metachars.
            .replace("\\*", `[^${PATH_SEPARATOR}]+`)  // Glob: '*'
            .replace("\\*\\*", ".*")                             // Glob: '**'
            .replace(/\\\{([^}]+(?:,[^}]+)+)\\\}/,               // Glob: '{a,b}'
                (_, [arg]) => `(?:${arg.split(",").join("|")})`)

        return new RegExp(globAsRegex);
    }

    return { invalid: pattern };
}

/**
 * Checks if a pattern is invalid.
 * @param pattern The pattern to check.
 * @returns True if invalid.
 */
export function isInvalidPattern(pattern: Pattern): boolean {
    if ('invalid' in pattern) return true;
    const compiled = compilePattern(pattern);
    return !(compiled instanceof RegExp);
}

/**
 * Gets the type of a pattern.
 * This will unwrap an invalid pattern and return its underlying type.
 *
 * @param pattern The pattern.
 */
export function getPatternType(pattern: Pattern): 'glob' | 'regex' {
    if ('glob' in pattern) return 'glob';
    if ('regex' in pattern) return 'regex';
    if ('invalid' in pattern) return getPatternType(pattern.invalid);

    throw new Error("Unknown pattern type: " + JSON.stringify(pattern));
}

/**
 * Gets the string value of a pattern.
 * This will unwrap an invalid pattern and return its underlying value.
 *
 * @param pattern The pattern.
 */
export function getPatternValue(pattern: Pattern): string {
    if ('glob' in pattern) return pattern.glob;
    if ('regex' in pattern) return pattern.regex;
    if ('invalid' in pattern) return getPatternType(pattern.invalid);

    throw new Error("Unknown pattern type: " + JSON.stringify(pattern));
}

/**
 * Checks if two patterns are equal.
 * @param a The first pattern.
 * @param b The second pattern.
 * @returns True if they are equal.
 */
export function arePatternsEqual(a: Pattern|null, b: Pattern|null): boolean {
    if (a == b /* identity check */) return true;
    if (a == null || b == null /* null check */) return false;
    if (isInvalidPattern(a) != isInvalidPattern(b)) return false;
    return getPatternType(a) === getPatternType(b)
        && getPatternValue(a) === getPatternValue(b);
}

function clonePattern(pattern: Pattern): Pattern {
    if ('invalid' in pattern) {
        return {invalid: {...pattern.invalid}};
    }

    return {...pattern};
}

/**
 * Settings UI for changing a {@link PatternSet}.
 */
export class PatternSetSetting {
    private static PLACEHOLDER_TEXT = {
        "new": "create a new pattern",
        "glob": "an/example.*",
        "regex": "an/example\\..*"
    };

    private setting: Setting;
    private value: PatternSet;
    private rowsContainerEl: HTMLDivElement;
    private onChangeListeners: ((patterns: PatternSet) => void)[];

    public constructor(setting: Setting, defaultValue: Pattern[]) {
        this.onChangeListeners = [];
        this.value = new PatternSet(defaultValue);
        this.setting = setting;

        // Create the container div.
        this.setting.settingEl.classList.add("sls-setting-vertical");
        this.rowsContainerEl = this.setting.controlEl.createDiv({
            cls: "sls-setting-group"
        });

        // Render the initial contents.
        this.render();

        // Add DOM listeners to notify onChange listeners.
        this.rowsContainerEl.addEventListener("change", this.handleFieldChange.bind(this));
        this.rowsContainerEl.addEventListener("focusout", (evt) => {
            if ((evt.target as HTMLElement).nodeName === "INPUT") {
                this.handleFieldChange(evt);
            }
        });
    }

    /**
     * Called whenever the pattern set is changed.
     *
     * @param listener The listener.
     */
    public onChange(listener: (patterns: PatternSet) => any) {
        this.onChangeListeners.push(listener);
    }

    /**
     * Resets this setting to a list of default values.
     * This will notify all listeners.
     *
     * @param patterns The default values.
     */
    public resetTo(patterns: Pattern[]) {
        this.value = new PatternSet(patterns);
        this.render();
        this.notifyOnChange();
    }

    private notifyOnChange() {
        const copy = this.value.clone();
        this.onChangeListeners.forEach(l => l(copy));
    }

    /**
     * Render all the patterns of this setting.
     */
    protected render() {
        // Clear the elements.
        while (this.rowsContainerEl.firstChild != null) {
            this.rowsContainerEl.removeChild(this.rowsContainerEl.firstChild);
        }

        // Add the existing patterns.
        for (const pattern of this.value.entries()) {
            const container = this.rowsContainerEl.createDiv();
            this.renderRow(container, pattern);
        }

        // Add an empty field for a new pattern.
        this.renderRow(this.rowsContainerEl.createDiv());
    }

    /**
     * Render a single pattern into a container element.
     *
     * @param container The container element.
     * @param value The value to render.
     */
    protected renderRow(container: HTMLDivElement, value?: Pattern) {
        const currentValueType = value == null ? "new" : getPatternType(value);

        // Clear the elements.
        while (container.firstChild != null) {
            container.removeChild(container.firstChild);
        }

        // Set the attributes.
        container.classList.add("sls-setting-group-row");
        container.setAttribute("data-sls-pattern-type", currentValueType);
        container.setAttribute("data-sls-pattern-status", "ok");
        if (value == null) {
            container.removeAttribute("data-sls-pattern-original-value");
        } else {
            container.setAttribute("data-sls-pattern-original-value", JSON.stringify(value));
        }

        // Create the type dropdown.
        const typeField = container.createEl("select", {
            attr: {
                type: "text",
            }
        });

        for (const patternType of ["glob", "regex"]) {
            const patternTypeIsSelected = value != null && getPatternType(value) === patternType;
            typeField.createEl("option", {
                text: patternType,
                attr: patternTypeIsSelected ? {selected: true} : {},
            });
        }

        // Create the value field.
        container.createEl("input", {
            attr: {
                type: "text",
                value: currentValueType === 'new' ? "" : getPatternValue(value),
                placeholder: PatternSetSetting.PLACEHOLDER_TEXT[currentValueType]
            }
        });

        // Create the status field.
        const statusField = container.createEl("div", {
            cls: "sls-pattern-status"
        });

        if (value != null) {
            if (isInvalidPattern(value)) {
                container.setAttribute("data-sls-pattern-status", "invalid");
                statusField.textContent = "❌";
            } else {
                container.setAttribute("data-sls-pattern-status", "ok");
                statusField.textContent = "✅";
            }
        }
    }

    /**
     * Determines the actions to perform when a field within this setting changes.
     */
    protected handleFieldChange(event: FocusEvent) {
        const target = event.target as HTMLElement;

        // Get the elements that specify the pattern type and value.
        const container = target.parentElement;
        const patternType = container.getAttribute("data-sls-pattern-type");
        const oldPatternJson = container.getAttribute("data-sls-pattern-original-value");
        const oldPattern = oldPatternJson == null ? null : JSON.parse(oldPatternJson);
        if (patternType == null) {
            // The event is not related to a pattern setting row.
            return;
        }

        // Get the new pattern.
        const typeField = container.querySelector("select") as HTMLSelectElement;
        const valueField = container.querySelector("input") as HTMLInputElement;
        const pattern = {[typeField.value]: valueField.value} as Pattern;

        // Do nothing if:
        //  1. The new pattern is empty and there wasn't previously a pattern; or
        //  2. The new pattern is the same as the old pattern.
        if ((valueField.value.length === 0 && oldPattern == null)
            || (arePatternsEqual(pattern, oldPattern))) {
            return;
        }

        // If the new pattern is empty and there was previously a pattern for this row, delete it.
        if (valueField.value.length === 0) {
            this.handlePatternDelete(container as HTMLDivElement, oldPattern);
            this.notifyOnChange();
            return;
        }


        // If the new pattern is the same as the old pattern, do nothing.
        if (oldPattern != null && arePatternsEqual(oldPattern, pattern)) {
            return;
        }

        // If there was not previously a pattern for this row, create a new pattern.
        if (oldPattern == null) {
            this.handlePatternCreate(container as HTMLDivElement, pattern);
            this.notifyOnChange();
            return;
        }

        // If there's already a pattern that is equivalent to the new pattern:
        //   -> We have a violation of a set data structure (no duplicates)
        //   -> Treat it as a deletion of the pattern that used to be in this row.
        if (this.value.has(pattern)) {
            this.handlePatternDelete(container as HTMLDivElement, oldPattern);
            this.notifyOnChange();
            return;
        }

        // By this point, we know that it's an old pattern that needs to be updated.
        this.handlePatternEdit(container as HTMLDivElement, oldPattern, pattern);
        this.notifyOnChange();
    }

    protected handlePatternEdit(container: HTMLDivElement, oldPattern: Pattern, newPattern: Pattern) {
        this.value.replace(oldPattern, newPattern);
        this.renderRow(container, newPattern);
    }

    protected handlePatternDelete(container: HTMLDivElement, deletedPattern: Pattern) {
        this.value.remove(deletedPattern);
        container.remove();
    }

    protected handlePatternCreate(container: HTMLDivElement, newPattern: Pattern) {
        this.value.add(newPattern);
        this.renderRow(container, newPattern);

        // Create a new row for the next entry.
        this.renderRow(this.rowsContainerEl.createDiv())
    }

}

export function createPatternSetSetting(patterns: Pattern[], callback: (pss: PatternSetSetting) => any): (setting: Setting) => void {
    return (s) => {
        const pss = new PatternSetSetting(s, patterns);
        callback(pss);
    }
}
