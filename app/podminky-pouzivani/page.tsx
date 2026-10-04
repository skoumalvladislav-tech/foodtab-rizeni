import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Podmínky používání – Foodtab",
};

/**
 * Podmínky používání — veřejná stránka, bez přihlášení.
 *
 * PRVNÍ NÁVRH, NE HOTOVÝ PRÁVNÍ DOKUMENT — stejné upozornění jako
 * sesterská stránka `/zasady-ochrany-osobnich-udaju`, vznikla ze
 * stejného důvodu (registrace appky u Enable Banking vyžaduje
 * veřejnou adresu podmínek).
 */
export default function PodminkyPouzivani() {
  return (
    <main style={stranka}>
      <article style={obsah}>
        <p style={ramecek}>
          <strong>Tohle je první návrh, ne hotový právní dokument.</strong> Před
          nasazením appky pro skutečné platící klienty by znění měl
          zkontrolovat nebo napsat právník.
        </p>

        <h1 style={h1}>Podmínky používání</h1>
        <p style={aktualizovano}>Poslední úprava: 4. 10. 2026.</p>

        <h2 style={h2}>Co je Foodtab</h2>
        <p>
          Foodtab je systém pro řízení restaurací a gastro provozů —
          rozpis směn, docházka, úkoly a komunikace týmu, finance a
          účetnictví, marketing. Appku používá firma (provozovatel
          restaurace nebo více provozoven) a její zaměstnanci, kterým
          firma založí přístup.
        </p>

        <h2 style={h2}>Založení účtu</h2>
        <p>
          Firma si založí účet a zve do něj své zaměstnance. Za
          správnost údajů, které do appky firma nebo její zaměstnanci
          vloží, a za to, že má právo tyto údaje (včetně osobních
          údajů zaměstnanců) zpracovávat, odpovídá firma.
        </p>

        <h2 style={h2}>Bankovní napojení</h2>
        <p>
          Appka umí k firemnímu účtu připojit bankovní účet (přímo u
          Fio banky, u ostatních bank přes zprostředkovatele Enable
          Banking), aby pohyby na účtu šlo spárovat s fakturami.
          Napojení je <strong>výhradně pro čtení</strong>: appka
          nezadává platby, inkasa ani jiné příkazy a nikdy nebude.
          Souhlas s přístupem dává firma dobrovolně a může ho kdykoli
          odvolat v appce i přímo u banky nebo zprostředkovatele.
        </p>

        <h2 style={h2}>Co appka dělá a co ne</h2>
        <p>
          Appka usnadňuje plánování, evidenci a komunikaci.
          Appka <strong>nenahrazuje</strong> mzdové, účetní ani daňové
          poradenství, pokladní (POS) systém ani bankovní aplikaci —
          kde appka tyhle systémy pouze čte nebo s nimi spolupracuje,
          je to tak popsáno přímo v appce.
        </p>

        <h2 style={h2}>Dostupnost a odpovědnost</h2>
        <p>
          Appka se snaží být dostupná nepřetržitě, ale nezaručuje
          bezchybný nebo nepřerušený provoz. V rozsahu, který dovoluje
          zákon, neodpovídáme za škodu způsobenou výpadkem, ztrátou dat
          způsobenou okolnostmi mimo naši kontrolu, ani za rozhodnutí
          učiněná na základě údajů nebo návrhů (včetně návrhů
          jazykového modelu), které appka pouze zobrazuje — poslední
          slovo má vždy člověk.
        </p>

        <h2 style={h2}>Vlastnictví dat</h2>
        <p>
          Data, která firma do appky vloží, zůstávají firmě. Appka je
          zpracovává jen pro provoz služby (viz{" "}
          <Link href="/zasady-ochrany-osobnich-udaju">Zásady ochrany
          osobních údajů</Link>). Firma si je může kdykoli
          vyexportovat; zaměstnanec si může vyexportovat svoje vlastní
          údaje na stránce <Link href="/moje-udaje">Moje údaje</Link>.
        </p>

        <h2 style={h2}>Ukončení</h2>
        <p>
          Firma může používání appky kdykoli ukončit. Po ukončení
          appka data uchová jen po dobu, kterou appce ukládá zákon,
          jinak je zlikviduje nebo anonymizuje.
        </p>

        <h2 style={h2}>Změny podmínek</h2>
        <p>
          Znění appka může časem upravit — hlavně proto, aby přesně
          odpovídalo tomu, co appka doopravdy dělá. O podstatné změně
          appka dá vědět s přiměřeným předstihem.
        </p>

        <h2 style={h2}>Rozhodné právo a kontakt</h2>
        <p>
          Tyto podmínky se řídí právem České republiky. S čímkoli nás
          kontaktujte na{" "}
          <a href="mailto:skoumalvladislav@gmail.com">skoumalvladislav@gmail.com</a>{" "}
          [doplnit: přesný název firmy, IČO, sídlo, vyhrazený kontakt].
        </p>

        <p style={zpet}>
          <Link href="/zasady-ochrany-osobnich-udaju">← Zásady ochrany osobních údajů</Link>
        </p>
      </article>
    </main>
  );
}

const stranka = {
  minHeight: "100dvh",
  background: "var(--paper)",
  padding: "32px 16px 64px",
} as const;

const obsah = {
  maxWidth: "720px",
  margin: "0 auto",
  color: "var(--ink)",
  fontSize: "15px",
  lineHeight: 1.65,
} as const;

const h1 = { fontSize: "26px", margin: "0 0 4px" } as const;
const h2 = { fontSize: "18px", margin: "28px 0 8px" } as const;
const aktualizovano = { margin: "0 0 24px", fontSize: "13px", color: "var(--muted)" } as const;
const zpet = { marginTop: "40px", paddingTop: "16px", borderTop: "1px solid var(--line)" } as const;

const ramecek = {
  margin: "0 0 28px",
  padding: "14px 16px",
  border: "1px solid var(--pozor)",
  borderRadius: "var(--radius-lg)",
  background: "var(--pozor-bg)",
  color: "var(--pozor)",
  fontSize: "14px",
  lineHeight: 1.6,
} as const;
