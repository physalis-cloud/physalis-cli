// ESLint (configuration « flat ») : règles recommandées JS + TypeScript,
// sur les sources et les tests e2e. dist/ est généré, donc ignoré.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
