import { ESLintUtils } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/mutav-finance/mutav-app/blob/main/packages/wallet/src/lint/${name}.ts`,
);

const KIT_PACKAGE = "@creit.tech/stellar-wallets-kit";
const FORBIDDEN_NAME = "allowAllModules";

export const rule = createRule({
  name: "no-allow-all-modules",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing or calling allowAllModules from @creit.tech/stellar-wallets-kit. " +
        "Use explicit module imports (FreighterModule, LobstrModule, XBullModule) instead. " +
        "See spec § Section 2.",
    },
    schema: [],
    messages: {
      noAllowAllModules:
        "Importing or calling `allowAllModules` from `@creit.tech/stellar-wallets-kit` is forbidden — use explicit module imports. See spec § Section 2.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== KIT_PACKAGE) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === FORBIDDEN_NAME
          ) {
            context.report({ node: specifier, messageId: "noAllowAllModules" });
          }
        }
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === FORBIDDEN_NAME) {
          context.report({ node, messageId: "noAllowAllModules" });
        }
      },
    };
  },
});
