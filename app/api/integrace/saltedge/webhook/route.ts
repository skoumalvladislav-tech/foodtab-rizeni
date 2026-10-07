import { NextResponse, type NextRequest } from 'next/server'

import { klientUlohy } from '@/lib/supabase/uloha'
import { overitPodpisWebhookuSaltEdge } from '@/lib/integrace-saltedge'

/**
 * Webhook Salt Edge Partners API — AUTORITATIVNÍ zdroj stavu připojení.
 *
 * Dokumentace: „nejdůležitější části API (správa připojení) jsou
 * asynchronní" — appka se proto NIKDY nespoléhá na parametry v adrese,
 * na kterou se uživatel vrátí z banky (`.../vratit`, nepodepsané, dal
 * by se zfalšovat) — `stav='pripojeno'` zapisuje VÝHRADNĖ tahle
 * adresa, po ověřeném podpisu (zadání §11: „Ověřuj... podpisy
 * webhooků").
 *
 * Běží BEZ přihlášeného uživatele (`klientUlohy`, service_role) —
 * stejný důvod jako `app/api/uloha/*`.
 *
 * `SALTEDGE_WEBHOOK_URL`/`SALTEDGE_WEBHOOK_PUBLIC_KEY` appka čte
 * z prostředí, NEHARDCODUJE ukázkový klíč z dokumentace (viz hlavička
 * `lib/integrace-saltedge.ts` — dokumentační mezera, co přesně se
 * podepisuje jako `callback_url`, se musí ověřit s partnerským
 * přístupem v ruce).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const syroveTelo = await request.text()
  const podpis = request.headers.get('signature')
  const callbackUrl = process.env.SALTEDGE_WEBHOOK_URL
  const verejnyKlic = process.env.SALTEDGE_WEBHOOK_PUBLIC_KEY

  if (!callbackUrl || !verejnyKlic) {
    // Appka úlohu nemá nastavenou vůbec — 503, ne tiché 200 (Salt Edge pak ví, že má zkusit znovu).
    return NextResponse.json({ chyba: 'Webhook Salt Edge není nastaven.' }, { status: 503 })
  }
  if (!podpis || !overitPodpisWebhookuSaltEdge(callbackUrl, syroveTelo, podpis, verejnyKlic)) {
    return NextResponse.json({ chyba: 'Neplatný nebo chybějící podpis.' }, { status: 401 })
  }

  let telo: {
    data?: {
      connection_id?: string
      customer_id?: string
      stage?: string
      consent_id?: string
      error_class?: string
      error_message?: string
    }
  }
  try {
    telo = JSON.parse(syroveTelo)
  } catch {
    return NextResponse.json({ chyba: 'Tělo webhooku není platný JSON.' }, { status: 400 })
  }

  const data = telo.data
  const connectionId = data?.connection_id
  const tenantId = data?.customer_id
  if (!connectionId || !tenantId) {
    // Appka hlásí 200 (callback je PODEPSANÝ a appka mu věří — jen
    // appku nezajímá, ne že by appka pochybovala o jeho pravosti),
    // ať Salt Edge neopakuje stejný typ callbacku donekonečna.
    return NextResponse.json({ zpracovano: false, duvod: 'callback appku nezajímá (chybí connection_id/customer_id)' })
  }

  const supabase = klientUlohy()
  if (!supabase) return NextResponse.json({ chyba: 'service_role není nastavený.' }, { status: 503 })

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('poskytovatel', 'saltedge')
    .eq('stav', 'pripojuje_se')
    .is('odpojeno_kdy', null)
    .maybeSingle()

  if (!pripojeni) {
    // Pozdní/zopakovaný callback k připojení, které appka už zpracovala
    // (nebo nikdy nezačala) — appka to nehlásí jako chybu Salt Edge.
    return NextResponse.json({ zpracovano: false, duvod: 'žádné odpovídající rozjeté připojení' })
  }

  if (data.error_class || data.error_message) {
    await supabase
      .from('integrace_pripojeni')
      .update({ stav: 'chyba', posledni_chyba: data.error_message ?? data.error_class ?? 'Salt Edge nahlásil chybu.', posledni_test_kdy: new Date().toISOString(), posledni_test_ok: false })
      .eq('id', pripojeni.id)
    return NextResponse.json({ zpracovano: true })
  }

  if (data.stage === 'finish') {
    const { data: aktualni } = await supabase.from('integrace_pripojeni').select('externi_ucet').eq('id', pripojeni.id).single()
    const puvodniExterniUcet = (aktualni?.externi_ucet ?? {}) as Record<string, unknown>

    await supabase
      .from('integrace_pripojeni')
      .update({
        stav: 'pripojeno',
        externi_ucet: { ...puvodniExterniUcet, connection_id: connectionId, consent_id: data.consent_id ?? null },
        posledni_test_kdy: new Date().toISOString(),
        posledni_test_ok: true,
      })
      .eq('id', pripojeni.id)
  }

  return NextResponse.json({ zpracovano: true })
}
