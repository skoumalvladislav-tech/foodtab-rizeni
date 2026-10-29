import 'server-only'

/**
 * Jiné platby — rozpoznání dokladu modelem Claude. Jen tenké volání:
 * zadání, schéma, kontrola podkladu a převod odpovědi jsou v
 * `lib/jine-platby-ai-jadro.ts` (testuje ho CI bez serveru).
 *
 * Pravidla (skill foodtab-ai, vzor lib/faktury-prijem-ai.ts):
 *   - do modelu jde jen uzavřený `PodkladRozpoznani` (soubory dokladu);
 *   - vadný podklad se odmítne DŘÍV, než se sáhne na klíč — o souboru,
 *     který stejně spadne, se nic neposílá ven;
 *   - bez klíče stav `bez_klice`, NIKDY vymyšlený doklad (vypadal by
 *     jako přečtený);
 *   - výsledek je NÁVRH: zapisuje se do `jine_platby_rozpoznani` a člověk
 *     ho potvrdí, AI nic nezapisuje do tržeb ani skladu.
 *
 * Denní strop (`AI_LIMIT_ZA_DEN`) a zápis pokusu hlídá serverová akce
 * přes `jine_platby_zahajit_rozpoznani` PŘED voláním této funkce.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

import type { RozpoznanyDoklad } from './jine-platby-typy.ts'
import {
  DokladSchema,
  MODEL,
  NAMAHA,
  VERZE_ZADANI,
  ZADANI,
  casNaCteni,
  maxTokenu,
  naRozpoznanyDoklad,
  sestavitObsah,
  zkontrolovatPodklad,
  type PodkladRozpoznani,
} from './jine-platby-ai-jadro.ts'

export type VysledekRozpoznani =
  | { stav: 'ok'; doklad: RozpoznanyDoklad; model: string; verze: string }
  | { stav: 'bez_klice' }
  | { stav: 'chyba'; duvod: string; docasna: boolean }

type ChybaRozpoznani = Extract<VysledekRozpoznani, { stav: 'chyba' }>

export const HLASKA_NEZBYVA_CAS = 'Na čtení nezbývá čas — zkuste to znovu.'
/** Vypršel čas zkrácený termínem `konec` — další pokus dostane plný čas (ověření 20. 10.). */
export const HLASKA_NESTIHLO = 'Čtení se nestihlo v čase, který zbýval — zkuste to znovu.'
/**
 * Useknutá odpověď (`max_tokens`) i vypršený čas (timeout) znamenají totéž:
 * doklad se do jednoho čtení nevejde. Opakování by dopadlo stejně a každé
 * se započítá do denního stropu — proto TRVALÁ chyba s radou, ne „zkuste znovu".
 */
export const HLASKA_MOC_DLOUHY = 'Doklad je na jedno čtení moc dlouhý — rozdělte ho, nebo zadejte položky ručně.'
export const HLASKA_ODMITNUTO = 'Model doklad odmítl přečíst — vyplňte položky ručně.'

export function rozpoznavaniJeNastavene(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

/**
 * `moznosti` řídí jen volání, do modelu z nich nejde nic:
 *   `casovyLimitMs` — nejdelší čekání na model (strop `CEKANI_NA_MODEL_MS`);
 *   `konec`         — termín (ms epoch), do kdy musí být hotovo i se zápisem;
 *                     model dostane nejvýš `konec − teď − 5 s` (N29). Když
 *                     vyjde méně než 15 s, model se nevolá a vrátí se dočasná
 *                     chyba (pokus by se zaplatil a nestihl).
 *
 * Strop odpovědi (`max_tokens`) se odvodí z téhož času (`maxTokenu`, C8):
 * model dostane jen tolik tokenů, kolik za `limit` stihne napsat. Dlouhý
 * doklad tak skončí včas na `max_tokens` → `HLASKA_MOC_DLOUHY`. Když
 * přesto vyprší čas (`APIConnectionTimeoutError`) při PLNÉM limitu, je to
 * taky TRVALÁ chyba `HLASKA_MOC_DLOUHY`, ne „zkuste znovu". Když limit
 * zkrátil termín `konec` (akce už část času spotřebovala), timeout je
 * DOČASNÝ `HLASKA_NESTIHLO`: další pokus dostane plný čas (ověření 20. 10.).
 * „Zkrátil“ = limit je pod 80 % toho, co akce měla na začátku (`zacatek`,
 * ověření 21. 10.).
 *
 * Volání je `messages.create` se strukturovaným výstupem a odpověď se
 * převádí TADY (N33): `messages.parse` v SDK 0.125 parsuje JSON dřív, než
 * vrátí odpověď, takže useknutá (max_tokens) nebo odmítnutá odpověď
 * s kusem textu skončila obecnou chybou „nešla přečíst" a konkrétní rada
 * se k člověku nedostala. Teď se nejdřív rozhodne podle `stop_reason`,
 * až pak JSON.parse a kontrola schématem (zod safeParse).
 */
export async function rozpoznatDoklad(
  p: PodkladRozpoznani,
  moznosti: { casovyLimitMs?: number; konec?: number; zacatek?: number } = {},
): Promise<VysledekRozpoznani> {
  // Kontrola podkladu PŘED klíčem: o vadném souboru se ven nic neposílá.
  const vada = zkontrolovatPodklad(p)
  if (vada) return trvala(vada)

  const klic = process.env.ANTHROPIC_API_KEY?.trim()
  if (!klic) return { stav: 'bez_klice' }

  const limit = casNaCteni(moznosti, Date.now())
  if (limit === null) return docasna(HLASKA_NEZBYVA_CAS)
  // „Zkrácený“ limit = akce před voláním modelu spotřebovala víc než pětinu
  // času, který měla na začátku (`zacatek`: zámek, stažení souborů). Limit
  // z termínu `konec` je pod stropem 100 s vždycky, srovnání se stropem by
  // dělalo každý timeout dočasným (ověření 21. 10.). Bez `zacatek` se
  // nezkracuje nic — timeout je trvalý.
  const zkracenoTerminem = typeof moznosti.zacatek === 'number' && limit < 0.8 * (casNaCteni(moznosti, moznosti.zacatek) ?? 0)

  // Žádné opakování uvnitř SDK: `timeout` platí pro každý pokus zvlášť, opakování by běh
  // přetáhlo přes strop serverové akce. Další pokus spustí člověk (započítá se do denního stropu).
  const client = new Anthropic({ apiKey: klic, timeout: limit, maxRetries: 0 })
  // Jen schéma (JSON) — pomocná funkce `parse` z SDK se neposílá ani nepoužívá.
  const format = zodOutputFormat(DokladSchema)

  let odpoved: Anthropic.Message
  try {
    odpoved = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokenu(limit),
      output_config: { effort: NAMAHA, format: { type: format.type, schema: format.schema } },
      system: ZADANI,
      messages: [{ role: 'user', content: sestavitObsah(p) }],
    })
  } catch (e) {
    if (zkracenoTerminem && e instanceof Anthropic.APIConnectionTimeoutError) return docasna(HLASKA_NESTIHLO)
    return chyba(e)
  }

  // 1. Nejdřív proč model skončil — useknutý nebo odmítnutý text se ani nezkouší číst.
  if (odpoved.stop_reason === 'refusal') return trvala(HLASKA_ODMITNUTO)
  if (odpoved.stop_reason === 'max_tokens' || odpoved.stop_reason === 'model_context_window_exceeded') return trvala(HLASKA_MOC_DLOUHY)

  // 2. Text odpovědi (přemýšlení a jiné bloky se přeskočí).
  const text = (Array.isArray(odpoved.content) ? odpoved.content : [])
    .filter((b): b is Anthropic.TextBlock => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
  if (text.trim() === '') return trvala('AI nevrátila žádné rozpoznané údaje.')

  // 3. JSON a schéma. Text odpovědi (kus dokladu) do důvodu nejde.
  let surovy: unknown
  try {
    surovy = JSON.parse(text)
  } catch {
    return trvala('Odpověď AI nešla přečíst jako rozpoznaný doklad (není to platný JSON) — zkuste to znovu, nebo vyplňte položky ručně.')
  }
  const vystup = DokladSchema.safeParse(surovy)
  if (!vystup.success) return trvala('Odpověď AI neodpovídá schématu dokladu — vyplňte ho ručně.')

  try {
    return { stav: 'ok', doklad: naRozpoznanyDoklad(vystup.data), model: odpoved.model, verze: VERZE_ZADANI }
  } catch (e) {
    return chyba(e)
  }
}

function trvala(duvod: string): ChybaRozpoznani {
  return { stav: 'chyba', duvod, docasna: false }
}

function docasna(duvod: string): ChybaRozpoznani {
  return { stav: 'chyba', duvod, docasna: true }
}

/**
 * Mapování jako lib/faktury-prijem-ai.ts, s jedinou výjimkou: timeout je
 * tady trvalá chyba (viz `HLASKA_MOC_DLOUHY`). Text odpovědi (kus dokladu)
 * do důvodu nejde.
 */
function chyba(e: unknown): ChybaRozpoznani {
  if (e instanceof Anthropic.AuthenticationError) {
    return trvala('Klíč k AI neplatí — zkontrolujte ANTHROPIC_API_KEY na serveru.')
  }
  if (e instanceof Anthropic.RateLimitError) {
    return docasna('AI je právě přetížená (limit požadavků). Zkuste to za chvíli.')
  }
  // Timeout při plném limitu (zkrácený termínem řeší rozpoznatDoklad): max_tokens je sladěný s časem,
  // takže čtení, které se nestihlo, je na jeden průchod moc dlouhé — trvalá chyba (C8).
  // Musí stát PŘED APIConnectionError (timeout je jeho podtřída).
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return trvala(HLASKA_MOC_DLOUHY)
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return docasna('Nepodařilo se spojit s AI. Zkuste to znovu.')
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status
    // 5xx včetně 529 (přetížení) a 408 jsou výpadek na druhé straně, ne vada dokladu.
    if (typeof status === 'number' && (status >= 500 || status === 408)) {
      return docasna(`AI má výpadek (chyba ${status}). Zkuste to znovu.`)
    }
    const telo = e.error as { error?: { message?: unknown } } | undefined
    const zprava = typeof telo?.error?.message === 'string' ? `: ${telo.error.message.slice(0, 200)}` : ''
    return trvala(`AI soubor nepřijala (chyba ${status ?? 'bez kódu'})${zprava}`)
  }
  // Zbylé chyby SDK jsou hlavně nepřečtená strukturovaná odpověď (i neznámý druh položky z kontroly schématem).
  if (e instanceof Anthropic.AnthropicError) {
    return trvala('Odpověď AI nešla přečíst jako rozpoznaný doklad (mohla být useknutá nebo mimo schéma).')
  }
  if (e instanceof Error && e.name === 'ZodError') {
    return trvala('Odpověď AI neodpovídá schématu dokladu — vyplňte ho ručně.')
  }
  return trvala(`Doklad se nepodařilo přečíst: ${e instanceof Error ? e.message.slice(0, 200) : 'neznámá chyba'}`)
}
