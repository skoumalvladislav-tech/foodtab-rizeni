import { NextResponse, type NextRequest } from 'next/server'

import { getServerSupabase } from '@/lib/supabase/server'
import { podpisSedi } from '@/lib/integrace-klice'
import { najitPokladnu } from '@/lib/pokladna-poskytovatele'
import { najitStejnyUcet, overitPokladnu, ulozitOverenePripojeni } from '@/lib/pokladna-pripojeni'
import type { ExterniUcetPokladny } from '@/lib/pokladna-prirazeni'
import { synchronizovatPokladnu } from '@/lib/pokladna-sync'

/**
 * Návrat z přihlášení do Dotykačky (Connector v2): `?token=…&cloudid=…&state=…`.
 *
 * Adrese appka sama NEVĚŘÍ: `state` musí nést podpis appky (vydala ho
 * `finance/integrace/pokladna/dotykacka/page.tsx`) a nesmí být prošlý;
 * token se před uložením ověří živým voláním Dotykačky; připojení se
 * hledá pod přihlášeným uživatelem (RLS) a jen ve stavu „Připojuje se…".
 *
 * Refresh token přijde v adrese — tak to Dotykačka navrhla. Appka ho
 * hned zašifruje a přesměruje na čistou adresu, aby nezůstal v historii
 * prohlížeče.
 *
 * Když už firma tenhle cloud připojený má (Cloud ID se shoduje), token
 * dostane TO připojení (přiřazení provozoven zůstane) a rozjetý pokus
 * se uzavře — žádná dvě připojení téhož účtu vedle sebe.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Stav = { p: string; r: string; e: number }

function rozebratStav(state: string | null): Stav | null {
  if (!state) return null
  const [obsah, podpis] = state.split('.')
  if (!obsah || !podpis) return null
  try {
    if (!podpisSedi(obsah, podpis)) return null
    const stav = JSON.parse(Buffer.from(obsah, 'base64url').toString('utf8')) as Stav
    if (typeof stav.p !== 'string' || typeof stav.r !== 'string' || typeof stav.e !== 'number') return null
    if (stav.e < Math.floor(Date.now() / 1000)) return null
    return stav
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const stav = rozebratStav(searchParams.get('state'))
  if (!stav) return NextResponse.redirect(new URL('/', request.url))

  const cil = (parametry: Record<string, string>) =>
    NextResponse.redirect(new URL(`/${stav.r}/finance/integrace/pokladna?${new URLSearchParams(parametry)}`, request.url))

  const supabase = await getServerSupabase()
  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, tenant_id, externi_ucet')
    .eq('id', stav.p)
    .eq('oblast', 'pokladna')
    .eq('poskytovatel', 'dotykacka')
    .eq('stav', 'pripojuje_se')
    .is('odpojeno_kdy', null)
    .maybeSingle()
  if (!pripojeni) return cil({ chyba: 'Tenhle pokus o připojení už appka zpracovala, nebo nepatří vašemu účtu.' })

  const token = searchParams.get('token')?.trim() ?? ''
  const cloudId = searchParams.get('cloudid')?.trim() ?? ''
  if (!token || !/^\d{1,15}$/.test(cloudId)) {
    await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: 'Dotykačka nevrátila přístup (přihlášení zrušeno?).' }).eq('id', pripojeni.id)
    return cil({ chyba: 'Dotykačka nevrátila přístup — přihlášení se nedokončilo.' })
  }

  const popis = najitPokladnu('dotykacka')!
  const udaje = { refresh_token: token, cloud_id: cloudId }

  const overeni = await overitPokladnu(popis.klic, udaje)
  if (overeni.stav === 'chyba') {
    await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: overeni.duvod }).eq('id', pripojeni.id)
    return cil({ chyba: `Dotykačka: přístup se nepodařilo ověřit — ${overeni.duvod}` })
  }

  const tenantId = pripojeni.tenant_id as string
  const puvodni = (pripojeni.externi_ucet ?? {}) as ExterniUcetPokladny
  const stejny = await najitStejnyUcet(supabase, tenantId, popis, { cloud_id: cloudId }, pripojeni.id as string)
  const ciloveId = stejny?.id ?? (pripojeni.id as string)

  const ulozeni = await ulozitOverenePripojeni(supabase, {
    pripojeniId: ciloveId,
    tenantId,
    popis,
    udaje,
    provozovny: overeni.provozovny,
    puvodniUcet: stejny?.externi_ucet ?? puvodni,
    historieOd: puvodni.historie_od ?? null,
  })
  if (ulozeni.stav === 'chyba') {
    await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: ulozeni.duvod }).eq('id', pripojeni.id)
    return cil({ chyba: ulozeni.duvod })
  }

  if (stejny) {
    // Rozjetý pokus nahradilo existující připojení téhož cloudu — uzavřít, ne nechat viset.
    await supabase.from('integrace_pripojeni').update({ stav: 'odpojeno', odpojeno_kdy: new Date().toISOString() }).eq('id', pripojeni.id)
  }

  if (ulozeni.prirazeno === 0) {
    return cil({ ok: `Dotykačka je ověřená (${ulozeni.celkem} provozoven). Teď u ní přiřaďte provozovny k pobočkám v appce.` })
  }

  const prvni = await synchronizovatPokladnu(ciloveId, { konecMs: Date.now() + 20_000 })
  return cil(prvni.stav === 'chyba'
    ? { chyba: `Dotykačka je připojená, ale první stažení se nepovedlo: ${prvni.duvod}` }
    : { ok: prvni.stav === 'ok' ? `Dotykačka je připojená. Staženo ${prvni.dnu} dní, ${prvni.zapsanoRadku} řádků prodeje.` : prvni.duvod })
}
