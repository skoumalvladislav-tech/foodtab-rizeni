import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**", "playwright-report/**", "test-results/**"]),
  {
    rules: {
      // Obrazovky jsou server-renderované a každá je force-dynamic; obyčejné
      // <a> je záměr — bez klientského routeru a bez hydratace navíc.
      "@next/next/no-html-link-for-pages": "off",
      // Obrázky chodí přes podepsané adresy s krátkou platností; optimalizace
      // next/image by je musela stahovat na serveru a podpis by mezitím prošel.
      "@next/next/no-img-element": "off",
    },
  },
]);
