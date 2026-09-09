import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Projekt leží uvnitř repozitáře FoodTab Řízení, který má vlastní
  // package-lock a postcss.config. Bez tohohle by Turbopack vzal za kořen
  // mateřskou složku a hledal Tailwind, který tady není.
  turbopack: { root: import.meta.dirname },
  outputFileTracingRoot: import.meta.dirname,
  // PGlite je WebAssembly a musí zůstat mimo bundler — v demo režimu
  // běží databáze přímo v procesu serveru (viz lib/db/README v docs/SETUP.md).
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  async redirects() {
    return [
      // Kořen vede na rozcestník, který vybere provozovnu podle přihlášení.
      { source: "/nastaveni", destination: "/nastaveni/integrace", permanent: false },
    ];
  },
};

export default nextConfig;
