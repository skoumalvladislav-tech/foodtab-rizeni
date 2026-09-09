import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Projekt leží uvnitř repozitáře FoodTab Řízení, který má vlastní
  // package-lock a postcss.config. Bez tohohle by Turbopack vzal za kořen
  // mateřskou složku a hledal Tailwind, který tady není.
  turbopack: { root: import.meta.dirname },
  outputFileTracingRoot: import.meta.dirname,
  // Písma pro převod SVG na PNG se čtou z disku za běhu, takže je Next
  // sám nevidí a do nasazeného balíčku by je nepřibalil. Bez nich se
  // v Lambdě vykreslí obrázek bez jediného písmene.
  outputFileTracingIncludes: { "/**": ["./assets/fonty/**"] },
  // PGlite je WebAssembly a musí zůstat mimo bundler — v demo režimu
  // běží databáze přímo v procesu serveru (viz lib/db/README v docs/SETUP.md).
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  experimental: {
    // Nahrávání médií jde přes server action; výchozí limit 1 MB by
    // nepustil ani jednu fotografii. Větší videa patří přes API
    // /api/v1/media (viz docs/SETUP.md).
    serverActions: { bodySizeLimit: "60mb" },
  },
  async redirects() {
    return [
      // Kořen vede na rozcestník, který vybere provozovnu podle přihlášení.
      { source: "/nastaveni", destination: "/nastaveni/integrace", permanent: false },
    ];
  },
};

export default nextConfig;
