import prettierConfig from "@vercel/style-guide/prettier";

/** @type {import("prettier").Config} */
const config = {
  ...prettierConfig,
  importOrder: [
    "^react$",
    "^next(/.*)?$",
    "<THIRD_PARTY_MODULES>",
    "^@louez/(.*)$",
    "^@/components/(.*)$",
    "^@/lib/(.*)$",
    "^@/hooks/(.*)$",
    "^@/contexts/(.*)$",
    "^@/(.*)$",
    "^[./]",
  ],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  tailwindPreserveWhitespace: false,
  plugins: [
    "@trivago/prettier-plugin-sort-imports",
    "prettier-plugin-tailwindcss",
  ],
  tailwindFunctions: ["tv", "cn", "cva", "clsx"],
};

export default config;
