import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Zásady ochrany osobních údajů – Foodtab",
};

/**
 * Zásady ochrany osobních údajů — veřejná stránka, bez přihlášení.
 *
 * NENÍ TOTÉŽ co `/moje-udaje#informace` (`privacy_notices`) — ta
 * obrazovka je informace KAŽDÉ FIRMY (tenanta) jejím vlastním
 * zaměstnancům, text si píše/upravuje firma sama. Tahle stránka je
 * o Foodtabu jako firmě/produktu — co appka jako poskytovatel dělá
 * s údaji na platformní úrovni. Patří k sobě, neslučuje se to.
 *
 * PRVNÍ NÁVRH, NE HOTOVÝ PRÁVNÍ DOKUMENT — stejné upozornění, jaké
 * appka používá u zástupného textu v `privacy_notices.je_zastupny`
 * (app/moje-udaje/page.tsx). Vznikla 4. 10. 2026 jako podklad pro
 * registraci appky u Enable Banking (vyžaduje veřejnou adresu), ne
 * jako dokončené prohlášení pro produkční klienty.
 */
export default function ZasadyOchranyOsobnichUdaju() {
  return (
    <main style={stranka}>
      <article style={obsah}>
        <p style={ramecek}>
          <strong>Tohle je první návrh, ne hotový právní dokument.</strong> Popisuje
          upřímně, co appka dělá s údaji dnes — než ho appka nasadí pro
          skutečné platící klienty, měl by znění zkontrolovat nebo
          napsat právník. Totéž pravidlo appka dodržuje u vlastního
          zástupného textu pro firmy (<Link href="/moje-udaje#informace">Moje údaje</Link>).
        </p>

        <h1 style={h1}>Zásady ochrany osobních údajů</h1>
        <p style={aktualizovano}>Poslední úprava: 4. 10. 2026.</p>

        <h2 style={h2}>Kdo stránky provozuje</h2>
        <p>
          Foodtab [doplnit: přesný název firmy, IČO, sídlo] (dále „Foodtab“,
          „my“) provozuje stejnojmenný systém pro řízení restaurací a
          gastro provozů (dále „appka“). Ve věcech ochrany osobních
          údajů nás zastihnete na{" "}
          <a href="mailto:skoumalvladislav@gmail.com">skoumalvladislav@gmail.com</a>{" "}
          [doplnit: vyhrazený kontakt, např. ochranaudaju@foodtab.cz].
        </p>

        <h2 style={h2}>Dvě role, ve kterých s údaji zacházíme</h2>
        <p>
          U firemních a provozních údajů vaší firmy (název, nastavení,
          fakturace appky) jsme <strong>správcem</strong> — rozhodujeme, k
          čemu je potřebujeme. U osobních údajů vašich zaměstnanců
          (jméno, kontakt, rozpis, docházka, mzda) jsme <strong>zpracovatelem</strong> —
          zpracováváme je jen proto a jen tak, jak nám to vaše firma jako
          správce zadá, podle smlouvy mezi vámi a námi. Firma sama pak
          svým zaměstnancům dluží vlastní informaci o zpracování —
          appka pro ni má místo na stránce{" "}
          <Link href="/moje-udaje">Moje údaje</Link>.
        </p>

        <h2 style={h2}>Jaké údaje zpracováváme a proč</h2>
        <ul style={seznam}>
          <li>
            <strong>Přihlašovací údaje</strong> — e-mail, kterým se
            přihlašujete (appka hesla nepoužívá, přihlašujete se kódem).
            Důvod: abyste se dostali ke svému účtu.
          </li>
          <li>
            <strong>Firemní a provozní údaje</strong> — název firmy a
            poboček, nastavení, k čemu appku používáte. Důvod: provoz
            samotné služby.
          </li>
          <li>
            <strong>Zaměstnanecké údaje</strong> — jméno, telefon,
            e-mail, zařazení, rozpis směn, docházka, mzdová sazba a
            odpracované hodiny. Důvod: plánování provozu a mzdová
            agenda vaší firmy; appka je zpracovatelem, ne správcem (viz
            výš).
          </li>
          <li>
            <strong>Bankovní pohyby</strong> — u firem, které si ve
            Finance → Integrace připojí bankovní účet (dnes Fio banka,
            připravujeme napojení přes zprostředkovatele Enable
            Banking), appka čte zůstatky a pohyby na účtu, aby je
            uměla spárovat s fakturami. Vždy jen <strong>čtení</strong> —
            appka nikdy nezadá platbu, inkaso ani jiný příkaz, a
            přístup lze kdykoli v appce i přímo u banky/zprostředkovatele
            odpojit.
          </li>
          <li>
            <strong>Technické údaje</strong> — přihlašovací session
            (cookie), základní provozní logy. Důvod: bezpečnost a
            provoz appky.
          </li>
        </ul>

        <h2 style={h2}>Umělá inteligence a vaše údaje</h2>
        <p>
          Appka používá jazykový model (Claude od Anthropicu) na
          vybraných místech — návrh marketingového textu, čtení menu z
          fotky, vysvětlení hotových finančních čísel. Do modelu se{" "}
          <strong>nikdy</strong> neposílají mzdy, docházka, kontakty
          zaměstnanců ani zálohy — appka to vynucuje už tím, jak jsou
          tyhle funkce napsané, ne jen slibem. Bez vlastního ani
          firemního klíče appka tyhle funkce buď vrátí viditelně
          označenou ukázku, nebo (u čtení menu) čistě odmítne — nikdy
          nepředstírá, že si obsah vymyslela appka sama.
        </p>

        <h2 style={h2}>Komu údaje předáváme</h2>
        <p>Údaje nezpracováváme sami na vlastních serverech. Používáme:</p>
        <ul style={seznam}>
          <li><strong>Supabase</strong> — databáze a přihlašování.</li>
          <li><strong>Vercel</strong> — hosting appky.</li>
          <li><strong>Anthropic</strong> — jazykový model pro funkce popsané výš.</li>
          <li>
            <strong>Fio banka / Enable Banking</strong> — jen u firem,
            které si účet aktivně připojí; čtou se jen zůstatky a
            pohyby na JEJICH účtu.
          </li>
          <li>Poskytovatel e-mailu, kterým appka rozesílá přihlašovací kódy a upozornění.</li>
        </ul>
        <p>
          Údaje neprodáváme a nepředáváme nikomu jinému za účelem
          reklamy.
        </p>

        <h2 style={h2}>Jak dlouho údaje uchováváme</h2>
        <p>
          Po dobu trvání vaší smlouvy s Foodtabem a dál jen v rozsahu,
          který appce ukládá zákon (např. mzdová a účetní evidence). Po
          zrušení účtu firmy údaje mažeme nebo anonymizujeme, pokud
          appce zákon neukládá jinak.
        </p>

        <h2 style={h2}>Vaše práva</h2>
        <p>
          Právo na přístup, opravu, výmaz a přenositelnost svých
          osobních údajů uplatníte přímo v appce na stránce{" "}
          <Link href="/moje-udaje">Moje údaje</Link> — vidíte tam, co o
          vás appka vede, můžete si opravit kontakt a vlastní údaje si
          vyexportovat. Pro cokoli dalšího (výmaz, vznesení námitky)
          nás kontaktujte na adrese výš.
        </p>

        <h2 style={h2}>Změny těchto zásad</h2>
        <p>
          Znění může appka časem upravit — hlavně proto, aby přesně
          odpovídalo tomu, co appka doopravdy dělá. Aktuální verze je
          vždy tady.
        </p>

        <p style={zpet}>
          <Link href="/podminky-pouzivani">Podmínky používání →</Link>
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
const seznam = { margin: "0 0 16px", paddingLeft: "20px", display: "grid", gap: "8px" } as const;
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
