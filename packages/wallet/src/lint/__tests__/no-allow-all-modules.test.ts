import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import { rule } from "../no-allow-all-modules";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester();

ruleTester.run("no-allow-all-modules", rule, {
  valid: [
    {
      code: `import { FreighterModule } from "@creit.tech/stellar-wallets-kit";`,
    },
    {
      code: `
        import { StellarWalletsKit, FreighterModule } from "@creit.tech/stellar-wallets-kit";
        const kit = new StellarWalletsKit({ modules: [new FreighterModule()] });
      `,
    },
  ],
  invalid: [
    {
      code: `import { allowAllModules } from "@creit.tech/stellar-wallets-kit";`,
      errors: [{ messageId: "noAllowAllModules" }],
    },
    {
      code: `
        import { StellarWalletsKit, allowAllModules } from "@creit.tech/stellar-wallets-kit";
        const kit = new StellarWalletsKit({ modules: allowAllModules() });
      `,
      errors: [{ messageId: "noAllowAllModules" }, { messageId: "noAllowAllModules" }],
    },
  ],
});
