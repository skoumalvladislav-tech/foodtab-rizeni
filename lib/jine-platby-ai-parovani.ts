import 'server-only'

/**
 * Jiné platby — přiřazení položek ke katalogu pokladny modelem Claude.
 * Jen tenké volání: podklad, zadání, schéma a převod odpovědi jsou
 * v `lib/jine-platby-ai-parovani-jadro.ts` (testuje ho CI bez serveru).
 *
 * Pravidla (skill foodtab-ai, vzor lib/jine-platby-ai.ts):
 *   - do modelu jde jen uzavřený `PodkladParovani` (názvy, množství a
 *     jednotky z dokladu, názvy a jednotky kandidátů z katalogu — žádné
 *     ceny, id produktů, lidé ani firma);
 *   - bez klíče stav `bez_klice`, NIKDY vymyšlené přiřazení (vypadalo by
 *     jako práce AI a člověk by ho mohl potvrdit);
 *   - výsledek je NÁVRH: serverová akce ho uloží jako `navrh` s důvodem
 *     ke kontrole. AI nic nezapisuje do skladu ani tržeb.
 *
 * Denní strop a záznam pokusu hlídá serverová akce přes
 * `jine_platby_zahajit_parovani` PŘED voláním této funkce.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

import {
  CEKANI_NA_MODEL_MS,
  MAX_TOKENU_ODPOVEDI,
  MODEL,
  NAMAHA,
  VERZE_ZADANI,
  VystupSchema,
  ZADANI,
  naPrirazeni,
  parovaniJeNastavene,
  sestavitZpravu,
  type MapaKandidatu,
  type PodkladParovani,
  type PrirazeniAI,
} from './jine-platby-ai-parovani-jadro.ts'

export type VysledekParovani =
  | { stav: 'ok'; prirazeni: PrirazeniAI[]; zahozeno: number; model: string; verze: string }
  | { stav: 'bez_klice' }
  | { stav: 'chyba'; duvod: string; docasna: boolean }

/** Pod tímhle časem se model nevolá — odpověď by nestihl a pokus by se jen zaplatil. */
const MIN_CAS_MS = 10_000
/** Rezerva mezi odpovědí modelu a termínem `konec` (uložení návrhu). */
const REZERVA_MS = 8_000

export { parovaniJeNastavene }

/**
 * `konec` (ms epoch) = do kdy musí být hotovo i s uložením — model dostane
 * nejvýš `konec − teď − 8 s` (a nejvýš `CEKANI_NA_MODEL_MS`).
 *
 * Volání je `messages.create` se strukturovaným výstupem; odpověď se čte
 * až po `stop_reason` (useknutá nebo odmítnutá odpověď = srozumitelná
 * chyba, ne „nešlo přečíst"), pak JSON a kontrola schématem (vzor
 * lib/jine-platby-ai.ts, N33).
 */
export async function naparovatPolozky(p: PodkladParovani, mapa: MapaKandidatu, moznosti: { konec?: number } = {}): Promise<VysledekParovani> {
  if (p.polozky.length === 0) return { stav: 'chyba', duvod: 'Žádná položka k přiřazení.', docasna: false }

  const klic = process.env.ANTHROPIC_API_KEY?.trim()
  if (!klic) return { stav: 'bez_klice' }

  const zbyva = typeof moznosti.konec === 'number' ? moznosti.konec - Date.now() - REZERVA_MS : CEKANI_NA_MODEL_MS
  const limit = Math.min(CEKANI_NA_MODEL_MS, zbyva)
  if (limit < MIN_CAS_MS) return { stav: 'chyba', duvod: 'Na přiřazení už nezbývá čas — zkuste to znovu.', docasna: true }

  // Žádné opakování uvnitř SDK: timeout platí pro každý pokus, opakování by přetáhlo strop akce.
  const client = new Anthropic({ apiKey: klic, timeout: limit, maxRetries: 0 })
  const format = zodOutputFormat(VystupSchema)

  let odpoved: Anthropic.Message
  try {
    odpoved = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENU_ODPOVEDI,
      output_config: { effort: NAMAHA, format: { type: format.type, schema: format.schema } },
      system: ZADANI,
      messages: [{ role: 'user', content: sestavitZpravu(p) }],
    })
  } catch (e) {
    return chyba(e)
  }

  if (odpoved.stop_reason === 'refusal') return { stav: 'chyba', duvod: 'Model přiřazení odmítl — přiřaďte položky ručně.', docasna: false }
  if (odpoved.stop_reason === 'max_tokens' || odpoved.stop_reason === 'model_context_window_exceeded') {
    return { stav: 'chyba', duvod: 'Položek je na jedno přiřazení moc — přiřaďte část ručně a zkuste to znovu.', docasna: false }
  }

  const text = (Array.isArray(odpoved.content) ? odpoved.content : [])
    .filter((b): b is Anthropic.TextBlock => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
  let surovy: unknown
  try {
    surovy = JSON.parse(text)
  } catch {
    return { stav: 'chyba', duvod: 'Odpověď AI nešla přečíst — zkuste to znovu, nebo přiřaďte položky ručně.', docasna: true }
  }
  if (!VystupSchema.safeParse(surovy).success) return { stav: 'chyba', duvod: 'Odpověď AI neodpovídá schématu — přiřaďte položky ručně.', docasna: false }

  const { prirazeni, zahozeno } = naPrirazeni(surovy, mapa)
  return { stav: 'ok', prirazeni, zahozeno, model: odpoved.model, verze: VERZE_ZADANI }
}

/** Chyby SDK → hláška pro člověka. Text odpovědi (kus dokladu) do důvodu nejde. */
function chyba(e: unknown): Extract<VysledekParovani, { stav: 'chyba' }> {
  if (e instanceof Anthropic.AuthenticationError) return { stav: 'chyba', duvod: 'Klíč k AI neplatí — zkontrolujte ANTHROPIC_API_KEY na serveru.', docasna: false }
  if (e instanceof Anthropic.RateLimitError) return { stav: 'chyba', duvod: 'AI je právě přetížená (limit požadavků). Zkuste to za chvíli.', docasna: true }
  // Timeout je podtřída APIConnectionError — musí být první.
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { stav: 'chyba', duvod: 'AI nestihla odpovědět — zkuste to znovu.', docasna: true }
  if (e instanceof Anthropic.APIConnectionError) return { stav: 'chyba', duvod: 'Nepodařilo se spojit s AI. Zkuste to znovu.', docasna: true }
  if (e instanceof Anthropic.APIError) {
    const status = e.status
    if (typeof status === 'number' && (status >= 500 || status === 408)) return { stav: 'chyba', duvod: `AI má výpadek (chyba ${status}). Zkuste to znovu.`, docasna: true }
    const telo = e.error as { error?: { message?: unknown } } | undefined
    const zprava = typeof telo?.error?.message === 'string' ? `: ${telo.error.message.slice(0, 200)}` : ''
    return { stav: 'chyba', duvod: `AI požadavek nepřijala (chyba ${status ?? 'bez kódu'})${zprava}`, docasna: false }
  }
  return { stav: 'chyba', duvod: `Přiřazení se nepodařilo: ${e instanceof Error ? e.message.slice(0, 200) : 'neznámá chyba'}`, docasna: false }
}
