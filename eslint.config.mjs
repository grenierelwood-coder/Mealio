import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "app/utils/matcher V3.6 old.tsx",
    "app/utils/matcher V3.4.tsx",
    "app/utils/matcher_claude.tsx",
    "app/utils/matcher_chatgpt_V3_1.tsx",
    "app/utils/matcher V3.5.tsx",
    "app/utils/matcher_old.tsx",
    "app/utils/stock-fetcher V3.4.tsx",
    "app/utils/matcher_chatgpt.tsx",
    "app/utils/stock-fetcher V3.3.tsx",
    "app/utils/stock-fetcher_old.tsx",
    "app/utils/matcher_V3.tsx",
    "app/utils/matcher V3.3.tsx",
    "app/utils/matcherV3.2.tsx",
    "app/matcher/page_old.tsx",
    "app/matcher/page V3.4.tsx",
    "app/lib/cookiwiki_old.tsx",
    "app/lib/supabase_old.tsx",
    "app/api/matcher/test/route V3.3.ts",
    "app/api/matcher/test/route_V1.ts",

  ]),
]);

export default eslintConfig;
