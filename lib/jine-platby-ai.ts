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

/** Výchozí čekání na model; serverová akce může dát kratší (`casovyLimitMs`). */
const CEKANI_MS = 100_000

export function rozpoznavaniJeNastavene(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

/** `moznosti` řídí jen volání (časový limit), do modelu z nich nejde nic. */
export async function rozpoznatDoklad(p: PodkladRozpoznani, moznosti: { casovyLimitMs?: number } = {}): Promise<VysledekRozpoznani> {
  // Kontrola podkladu PŘED klíčem: o vadném souboru se ven nic neposílá.
  const vada = zkontrolovatPodklad(p)
  if (vada) return trvala(vada)

  const klic = process.env.ANTHROPIC_API_KEY?.trim()
  if (!klic) return { stav: 'bez_klice' }

  const limit = moznosti.casovyLimitMs && moznosti.casovyLimitMs > 0 ? Math.min(CEKANI_MS, moznosti.casovyLimitMs) : CEKANI_MS
  // Žádné opakování uvnitř SDK: `timeout` platí pro každý pokus zvlášť, opakování by běh
  // přetáhlo přes strop serverové akce. Další pokus spustí člověk (započítá se do denního stropu).
  const client = new Anthropic({ apiKey: klic, timeout: limit, maxRetries: 0 })

  try {
    const odpoved = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: NAMAHA, format: zodOutputFormat(DokladSchema) },
      system: ZADANI,
      messages: [{ role: 'user', content: sestavitObsah(p) }],
    })

    if (odpoved.stop_reason === 'refusal') {
      return trvala('Model odmítl doklad zpracovat — vyplňte ho ručně.')
    }
    if (odpoved.stop_reason === 'max_tokens' || odpoved.stop_reason === 'model_context_window_exceeded') {
      return trvala('Odpověď AI byla useknutá (došel limit délky) — doklad je na automatické čtení moc dlouhý. Zkuste méně stránek najednou.')
    }

    const vystup = odpoved.parsed_output
    if (!vystup) return trvala('AI nevrátila žádné rozpoznané údaje.')

    return { stav: 'ok', doklad: naRozpoznanyDoklad(vystup), model: odpoved.model, verze: VERZE_ZADANI }
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

/** Stejné mapování jako lib/faktury-prijem-ai.ts. Text odpovědi (kus dokladu) do důvodu nejde. */
function chyba(e: unknown): ChybaRozpoznani {
  if (e instanceof Anthropic.AuthenticationError) {
    return trvala('Klíč k AI neplatí — zkontrolujte ANTHROPIC_API_KEY na serveru.')
  }
  if (e instanceof Anthropic.RateLimitError) {
    return docasna('AI je právě přetížená (limit požadavků). Zkuste to za chvíli.')
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return docasna('AI se neozvala včas. Zkuste to znovu.')
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
