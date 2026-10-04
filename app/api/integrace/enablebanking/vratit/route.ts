import { NextResponse, type NextRequest } from 'next/server'

import { getServerSupabase } from '@/lib/supabase/server'
import { enableBankingProvider, podepsatJwt } from '@/lib/integrace-enablebanking'

/**
 * Návrat z Enable Banking po souhlasu PSU (PSD2 redirect).
 *
 * `pripojeni`/`rozsah` si appka sama vložila do `redirect_url` při
 * zahájení (`zahajitPripojeniEnableBanking`) — Enable Banking k ní jen
 * PŘIDÁ `code`/`state`/`error`, ověřeno živě proti dokumentaci
 * („additional parameters added in its query string"), appka tedy obojí
 * dostane zpátky ve stejném požadavku.
 *
 * Appka STAV zjišťuje dotazem u poskytovatele (`dokoncitCallback`
 * → `POST /sessions`), ne z toho, co jen stojí v adrese — ta appce
 * nedokazuje, že souhlas doopravdy proběhl (zadání §2).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const pripojeniId = searchParams.get('pripojeni')
  const rozsah = searchParams.get('rozsah') ?? ''

  const cil = (parametry: Record<string, string>) =>
    NextResponse.redirect(new URL(`/${rozsah}/finance/integrace/banka?${new URLSearchParams(parametry)}`, request.url))

  if (!pripojeniId || !rozsah) {
    return cil({ chyba: 'Návrat z Enable Banking přišel bez očekávaných údajů.' })
  }

  const supabase = await getServerSupabase()

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, tenant_id, platebni_ucet_id, externi_ucet')
    .eq('id', pripojeniId)
    .eq('stav', 'pripojuje_se')
    .maybeSingle()

  if (!pripojeni) {
    return cil({ chyba: 'Tohle připojení už appka zpracovala, nebo nepatří vašemu účtu.' })
  }

  const vysledek = await enableBankingProvider.dokoncitCallback!(request.url)

  if (vysledek.stav === 'chyba') {
    await supabase
      .from('integrace_pripojeni')
      .update({ stav: 'chyba', posledni_chyba: vysledek.duvod, posledni_test_kdy: new Date().toISOString(), posledni_test_ok: false })
      .eq('id', pripojeni.id)
    return cil({ chyba: vysledek.duvod })
  }

  const ucet = vysledek.ucty[0]
  const puvodniExterniUcet = (pripojeni.externi_ucet ?? {}) as Record<string, unknown>

  await supabase
    .from('integrace_pripojeni')
    .update({
      stav: 'pripojeno',
      externi_ucet: { ...puvodniExterniUcet, account_uid: ucet.providerAccountId, iban: ucet.iban },
      posledni_test_kdy: new Date().toISOString(),
      posledni_test_ok: true,
    })
    .eq('id', pripojeni.id)

  /*
    První zůstatek best-effort — appka na něm nestaví úspěch celého
    připojení (to už je hotové výš). Pravidelnou synchronizaci dál
    dělá cron/manuální tlačítko (lib/integrace-fio-sync.ts vzor),
    Enable Banking tam dnes ještě není zapojený (vědomá mezera).
  */
  try {
    const token = await podepsatJwt()
    const zustatky = await enableBankingProvider.nactiZustatky!(ucet.providerAccountId, token)
    if (zustatky.stav === 'ok' && pripojeni.platebni_ucet_id) {
      for (const z of zustatky.zustatky) {
        await supabase.from('bankovni_zustatky').insert({
          tenant_id: pripojeni.tenant_id,
          platebni_ucet_id: pripojeni.platebni_ucet_id,
          typ: z.typ,
          castka_haleru: z.castkaHaleru,
          mena: z.mena,
          platny_k: z.platnyK,
          zdroj: 'bankovni_agregator',
          integrace_pripojeni_id: pripojeni.id,
        })
      }
    }
  } catch {
    // Zůstatek dokreslí další synchronizace — připojení samo je hotové beze změny.
  }

  return cil({ enablebanking: 'pripojeno' })
}
