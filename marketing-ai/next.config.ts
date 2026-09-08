import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
