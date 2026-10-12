import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { zasifrovat } from './integrace-klice.ts'
import { ADAPTERY_POKLADEN } from './pokladna-adaptery.ts'
import type { PopisPokladny } from './pokladna-poskytovatele.ts'
import { automatickePrirazeni, prirazeneProvozovny, sloucitProvozovny, type ExterniUcetPokladny } from './pokladna-prirazeni.ts'
import type { ChybaPos, ProvozovnaPos, UdajePos } from './pos-provider-contract.ts'

/**
 * Ověření a uložení přístupu k pokladně — společné pro „vložit token"
 * (`app/[rozsah]/finance/integrace/pokladna/akce.ts`) i návrat
 * z přihlášení do Dotykačky (`app/api/integrace/dotykacka/vratit`).
 *
 * Pořadí je pevné: NEJDŘÍV živé ověření u pokladny, teprve pak cokoli
 * do databáze — neplatný token nezaloží nic polorozbitého a „Připojeno"
 * appka nikdy neukáže bez ověřeného přístupu (zadání §2).
 *
 * Připojení pokladny s tokenem patří FIRMĚ (`branch_id` prázdné) —
 * k pobočkám se přiřazují jednotlivé provozovny pokladny
 * (`lib/pokladna-prirazeni.ts`).
 */

type Supabase = SupabaseClient

/**
 * Přístup aplikace Foodtab u Dotykačky (registrovaná Client Application).
 * Ořezané — hodnota vložená do Vercelu s koncem řádku by změnila HMAC
 * podpis a Dotykačka by každé přihlášení odmítla hláškou, která na mezery
 * neukazuje („Unknown client application or wrong application secret").
 */
export function klientDotykacky(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.DOTYKACKA_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.DOTYKACKA_CLIENT_SECRET?.trim() ?? ''
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/**
 * Živé ověření přístupu: přihlášení, seznam provozoven a jedno malé
 * čtení tržeb (poslední hodina první provozovny). Bez toho třetího by
 * připojení s platným tokenem, ale bez práva na přehled tržeb (licence,
 * zakázaná cesta), skončilo „Připojeno" a selhalo až při stahování.
 */
export async function overitPokladnu(klic: string, udaje: UdajePos): Promise<{ stav: 'ok'; provozovny: ProvozovnaPos[] } | { stav: 'chyba'; druh: ChybaPos['druh']; duvod: string }> {
  const adapter = ADAPTERY_POKLADEN[klic]
  if (!adapter) return { stav: 'chyba', druh: 'jina', duvod: 'Tuhle pokladnu appka neumí napojit sama.' }

  const otevreni = await adapter.otevrit(udaje)
  if (otevreni.stav === 'chyba') return otevreni

  const seznam = await otevreni.relace.provozovny()
  if (seznam.stav === 'chyba') return seznam
  if (seznam.provozovny.length === 0) return { stav: 'chyba', druh: 'jina', duvod: 'Přístup platí, ale pokladna nemá žádnou provozovnu.' }

  const ted = Date.now()
  const zkouska = await otevreni.relace.prodeje(seznam.provozovny[0].externiId, ted - 3_600_000, ted)
  if (zkouska.stav === 'chyba') return { ...zkouska, duvod: `Přihlášení platí, ale přehled tržeb se načíst nepodařilo — ${zkouska.duvod}` }

  return { stav: 'ok', provozovny: seznam.provozovny }
}

/** Netajná pole přístupu (Cloud ID) — podle nich appka pozná, že jde o TENTÝŽ účet pokladny, a uloží je k zobrazení. */
export function verejnaPole(popis: PopisPokladny, udaje: UdajePos): Record<string, string> {
  const verejne: Record<string, string> = {}
  for (const pole of popis.pole) {
    if (!pole.tajne && udaje[pole.klic]) verejne[pole.klic] = udaje[pole.klic]
  }
  return verejne
}

/**
 * Živé připojení téže pokladny a téhož účtu u poskytovatele (shoda
 * všech netajných polí, u Dotykačky Cloud ID). Nový token k němu se
 * nepřidá podruhé — dostane ho to existující a přiřazení zůstane.
 */
export async function najitStejnyUcet(
  supabase: Supabase,
  tenantId: string,
  popis: PopisPokladny,
  verejne: Record<string, string>,
  krome: string | null,
): Promise<{ id: string; externi_ucet: ExterniUcetPokladny } | null> {
  const { data } = await supabase
    .from('integrace_pripojeni')
    .select('id, externi_ucet')
    .eq('tenant_id', tenantId)
    .eq('oblast', 'pokladna')
    .eq('poskytovatel', popis.klic)
    .is('branch_id', null)
    .is('odpojeno_kdy', null)

  for (const radek of (data ?? []) as { id: string; externi_ucet: Record<string, unknown> | null }[]) {
    if (radek.id === krome) continue
    const ucet = radek.externi_ucet ?? {}
    if (Object.entries(verejne).every(([k, v]) => ucet[k] === v)) return { id: radek.id, externi_ucet: ucet as ExterniUcetPokladny }
  }
  return null
}

/**
 * Pobočky, které plní JINÉ živé napojení pokladny firmy — jakékoli
 * pokladny: přiřazené provozovny pokladen s tokenem i pobočka příjmového
 * API. Dvě napojení jedné pobočky by se ve foodcostu sečetla (CSV appka
 * odfiltruje, dvě API ne), proto tam přiřadit nejde.
 */
export async function obsazenePobocky(supabase: Supabase, tenantId: string, krome: string | null): Promise<Set<string>> {
  const { data } = await supabase
    .from('integrace_pripojeni')
    .select('id, branch_id, externi_ucet')
    .eq('tenant_id', tenantId)
    .eq('oblast', 'pokladna')
    .is('odpojeno_kdy', null)

  const obsazene = new Set<string>()
  for (const radek of (data ?? []) as { id: string; branch_id: string | null; externi_ucet: ExterniUcetPokladny | null }[]) {
    if (radek.id === krome) continue
    if (radek.branch_id) obsazene.add(radek.branch_id)
    for (const p of prirazeneProvozovny(radek.externi_ucet)) obsazene.add(p.branch_id)
  }
  return obsazene
}

/**
 * Uloží OVĚŘENÝ přístup k existujícímu připojení. Tajemství jde přes
 * `integrace_uloz_tajemstvi` pod přihlášeným uživatelem — databáze
 * sama ověří `integrace.manage` a firmu připojení. Provozovny se
 * sloučí s dosavadním přiřazením; jedinou provozovnu u firmy s jedinou
 * volnou pobočkou appka přiřadí sama.
 */
export async function ulozitOverenePripojeni(
  supabase: Supabase,
  v: {
    pripojeniId: string
    tenantId: string
    popis: PopisPokladny
    udaje: UdajePos
    provozovny: ProvozovnaPos[]
    puvodniUcet: ExterniUcetPokladny
    historieOd: string | null
  },
): Promise<{ stav: 'ok'; prirazeno: number; celkem: number } | { stav: 'chyba'; duvod: string }> {
  const { sifra, otisk } = zasifrovat(v.udaje)
  const { error: chybaKlice } = await supabase.rpc('integrace_uloz_tajemstvi', { p_pripojeni: v.pripojeniId, p_sifra: sifra, p_otisk: otisk })
  if (chybaKlice) return { stav: 'chyba', duvod: 'Přístup se ověřil, ale nepodařilo se ho uložit — zkuste to znovu.' }

  const [{ data: pobocky }, obsazene] = await Promise.all([
    supabase.from('branches').select('id').eq('tenant_id', v.tenantId).eq('active', true).is('deleted_at', null),
    obsazenePobocky(supabase, v.tenantId, v.pripojeniId),
  ])
  const provozovny = automatickePrirazeni(
    sloucitProvozovny(v.provozovny, v.puvodniUcet.provozovny ?? []),
    ((pobocky ?? []) as { id: string }[]).map((p) => p.id),
    obsazene,
  )
  const prirazeno = provozovny.filter((p) => p.branch_id).length

  // Nové přihlášení k už připojenému účtu historii nezkrátí: platí dřívější
  // z obou dat. Jinak by výchozí 1. 1. v nezměněném formuláři tiše zastavil
  // dohánění staršího roku a obrazovka by tvrdila „historie kompletní".
  const historieOd = [v.historieOd, v.puvodniUcet.historie_od].filter((d): d is string => Boolean(d)).sort()[0]

  const ucet: ExterniUcetPokladny = {
    ...v.puvodniUcet,
    ...verejnaPole(v.popis, v.udaje),
    ...(historieOd ? { historie_od: historieOd } : {}),
    provozovny,
  }

  const ted = new Date().toISOString()
  const { error } = await supabase
    .from('integrace_pripojeni')
    .update({
      stav: prirazeno > 0 ? 'pripojeno' : 'vyzaduje_pozornost',
      externi_ucet: ucet,
      capabilities: ADAPTERY_POKLADEN[v.popis.klic]?.schopnosti ?? {},
      posledni_test_kdy: ted,
      posledni_test_ok: true,
      posledni_chyba: prirazeno > 0 ? null : 'Přiřaďte provozovny pokladny k pobočkám v appce — dokud nejsou přiřazené, nic se nestahuje.',
    })
    .eq('id', v.pripojeniId)

  if (error) return { stav: 'chyba', duvod: 'Přístup je uložený, ale připojení se nepodařilo dokončit — zkuste to znovu.' }
  return { stav: 'ok', prirazeno, celkem: provozovny.length }
}
