import { rule as noAllowAllModules } from "./no-allow-all-modules.ts";

export const plugin = {
  meta: {
    name: "@mutav/wallet/lint",
    version: "0.1.0",
  },
  rules: {
    "no-allow-all-modules": noAllowAllModules,
  },
};

export default plugin;
