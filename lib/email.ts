import 'server-only'

/**
 * Odesílání e-mailů přes Resend.
 *
 * Jde přes jejich HTTP rozhraní obyčejným `fetch`em, ne přes balíček.
 * Je to jedno volání a závislostí má tenhle projekt schválně málo.
 *
 * KLÍČ NIKDY NEJDE DO PROHLÍŽEČE. Proměnná se proto nejmenuje
 * `NEXT_PUBLIC_…` — Next takové proměnné vkládá do klientského balíku.
 * `server-only` nahoře je druhá závora: kdyby tenhle soubor někdo
 * omylem naimportoval do klientské komponenty, projekt se nepřeloží.
 */

const KONCOVKA = 'https://api.resend.com/emails'
const ODESILATEL = 'Foodtab <noreply@foodtab.cz>'

/**
 * Jak dopadlo odeslání.
 *
 * `nenastaveno` je vlastní stav schválně. Chybějící klíč není porucha
 * odesílání — je to nedodělané prostředí a čte se jinak než „Resend to
 * odmítl“. Obojí se ale MUSÍ ukázat: pozvánka, o které si vedoucí
 * myslí, že odešla, je horší než chyba (docs/pozvanky-zadani.md).
 */
export type Odeslani =
  | { stav: 'odeslano' }
  | { stav: 'nenastaveno' }
  | { stav: 'chyba'; text: string }

export async function odeslatEmail(zprava: {
  komu: string
  predmet: string
  text: string
  html: string
}): Promise<Odeslani> {
  const klic = process.env.RESEND_API_KEY
  if (!klic) return { stav: 'nenastaveno' }

  try {
    const odpoved = await fetch(KONCOVKA, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${klic}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: ODESILATEL,
        to: [zprava.komu],
        subject: zprava.predmet,
        text: zprava.text,
        html: zprava.html,
      }),
      // Bez tohohle by se při výpadku Resendu vystavení pozvánky
      // zaseklo na výchozím timeoutu a vedoucí by koukal na točící se
      // tlačítko. Deset vteřin je víc než dost.
      signal: AbortSignal.timeout(10_000),
    })

    if (!odpoved.ok) {
      // Tělo chyby je od Resendu a bývá srozumitelné („domain is not
      // verified“). Projde se dál, ať se nevymýšlí druhá hláška.
      const telo = await odpoved.text().catch(() => '')
      return { stav: 'chyba', text: strucne(telo) || `Resend odpověděl ${odpoved.status}.` }
    }

    return { stav: 'odeslano' }
  } catch (duvod) {
    return {
      stav: 'chyba',
      text: duvod instanceof Error ? duvod.message : 'Spojení s Resendem selhalo.',
    }
  }
}

/**
 * Z odpovědi Resendu vytáhne větu pro člověka.
 *
 * Vrací se JSON s polem `message`. Když se ho nepodaří přečíst, radši
 * se ukáže useknutý originál než nic — vedoucí ho může poslat dál.
 */
function strucne(telo: string): string {
  try {
    const j = JSON.parse(telo) as { message?: unknown; error?: { message?: unknown } }
    const m = j.message ?? j.error?.message
    if (typeof m === 'string' && m.trim()) return m.trim()
  } catch {
    /* není to JSON — použije se originál */
  }
  return telo.slice(0, 200).trim()
}
