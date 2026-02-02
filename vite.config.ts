import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vitest.config.common";

export default mergeConfig(viteConfig, defineConfig({}));
