# Dynamic Load Modules

## Introduction

Self-hosted LiveSync has gradually but steadily become very feature-rich and they have created a very heavy `Main` class. This is very difficult to understand and maintain especially new contributors or futures contributors.
And some of the features are not used by all users, we should limit the inter-dependencies between modules. And also inter-effects between modules.
Hence, to make the code more readable and maintainable, I decided to split the code into multiple modules.

I also got a little greedy here, but I have an another objective now, which is to reduce the difficulty when porting to other platforms.

Therefore, almost all feature of the plug-in can be implemented as a module. And the `Main` class will be responsible for loading these modules.

## Modules

### Sorts

Modules can be sorted into two categories in some sorts:

-   `CoreModule` and `ObsidianModule`
-   `Core`, `Essential`, and `Feature` ... 

### How it works

After instancing `Core` and Modules, you should call `injectModules`. Then, the specific function will be injected into the stub of it of `Core` class by following rules:

| Function prefix | Description                                                       |
| --------------- | ----------------------------------------------------------------- |
| `$$`            | Completely overridden functions.                                  |
| `$all`          | Process all modules and return all results.                       |
| `$every`        | Process all modules until the first failure.                      |
| `$any`          | Process all modules until the first success.                      |
| `$`             | Other interceptive points. You should manually assign the module. |

Note1: `Core` class should implement the same function as the module. If not, the module will be ignored.

And, basically, the Module has a `Core` class as `core` property. You should call any of inject functions by `this.core.$xxxxxx`. This rule is also applied to the function which implemented itself. Because some other modules possibly injects the function again, for the specific purpose.

### CoreModule

This Module is independent from Obsidian, and can be used in any platform. However, it can be call (or use) functions which has implemented in `ObsidianModule`.
To porting, you should implement shim functions for `ObsidianModule`.

### ObsidianModule

(TBW)