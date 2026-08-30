import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        /*
          Moje směny se sloučily do Docházky. Adresa musí dál fungovat:
          lidé ji mají v záložkách a je na rozeslaném QR kódu. Řeší se
          to tady, ne stránkou s přesměrováním — takhle odpoví server
          rovnou, bez vykreslování a bez načítání dat.

          Trvalé (308) proto, že obrazovka se nevrátí. Prohlížeč si to
          zapamatuje, takže QR kód nemusí sahat na server pokaždé.
        */
        source: "/:rozsah/moje-smeny",
        destination: "/:rozsah/dochazka",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
