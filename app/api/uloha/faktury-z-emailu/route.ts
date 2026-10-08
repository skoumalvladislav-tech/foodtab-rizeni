import { NextResponse } from 'next/server'

import { tajemstviSedi } from '@/lib/supabase/uloha'
import { vsechnaPripojeniSPrijmem, zpracovatPrijem, type VysledekPrijmu } from '@/lib/faktury-prijem-sync'
import { automatickyParovatPlatby } from '@/lib/finance-automaticke-parovani'

/**
 * Naplánovaná úloha: průběžný příjem faktur z připojených schránek
 * (Šéfík 8.10.2026: „faktury ať se zpracovávají průběžně").
 *
 * Stejný vzor jako banka-synchronizace — Bearer CRON_SECRET, service_role
 * jen uvnitř lib/faktury-prijem-sync.ts. Jedno volání má ~50 s; schránky
 * se zpracovávají jedna po druhé ve společném časovém rozpočtu. Velký
 * dávkový dočet (od 1.1.2026) se rozloží do víc volání — workflow
 * faktury-z-emailu.yml volá znovu, dokud `pokracovat` je true.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROZPOCET_MS = 50_000

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null
  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  const konecMs = Date.now() + ROZPOCET_MS
  const pripojeni = await vsechnaPripojeniSPrijmem()

  const vysledky: (VysledekPrijmu & { id: string })[] = []
  for (const p of pripojeni) {
    if (Date.now() >= konecMs - 5_000) break
    try {
      vysledky.push({ id: p.id, ...(await zpracovatPrijem(p.id, { konecMs })) })
    } catch (e) {
      vysledky.push({
        id: p.id, stav: 'chyba', duvod: e instanceof Error ? e.message : String(e),
        nalezeno: 0, zapsano: 0, existuje: 0, kontrola: 0, zbyva: 0, schrankaDoctena: false,
      })
    }
  }

  // Nová faktura může přijít až po platbě — zkusit ji hned spárovat (jen
  // jednoznačná shoda; viz lib/finance-automaticke-parovani.ts).
  const vlastnikFaktur = process.env.FAKTURY_DB_TENANT_ID?.trim()
  // Jen když zbývá aspoň 15 s z rozpočtu — načtení dat trvá pár sekund.
  const parovani = vlastnikFaktur && vysledky.some((v) => v.zapsano > 0) && Date.now() < konecMs - 15_000
    ? await automatickyParovatPlatby(vlastnikFaktur, { konecMs: konecMs + 5_000 })
    : null

  const neprobehla = pripojeni.length - vysledky.length
  const pokrok = vysledky.some((v) => v.nalezeno + v.zapsano + v.existuje + v.kontrola > 0)
  const zbyvaPrace = neprobehla > 0 || vysledky.some((v) => v.stav === 'ok' && (v.zbyva > 0 || !v.schrankaDoctena))

  return NextResponse.json({
    schranek: pripojeni.length,
    zapsano: vysledky.reduce((s, v) => s + v.zapsano, 0),
    uhrazeno: parovani?.sparovano ?? 0,
    nalezeno: vysledky.reduce((s, v) => s + v.nalezeno, 0),
    kontrola: vysledky.reduce((s, v) => s + v.kontrola, 0),
    zbyva: vysledky.reduce((s, v) => s + v.zbyva, 0),
    // Volat znovu má smysl, jen když se v tomhle běhu něco pohnulo a práce zbývá —
    // jinak by workflow točil donekonečna nad tím, co čeká na člověka nebo na AI.
    pokracovat: zbyvaPrace && (pokrok || neprobehla > 0),
    // Bez id schránek a bez textů chyb: odpověď končí v logu GitHub Actions a
    // repozitář je veřejný. Důvod chyby je u schránky v Integracích → E-mail.
    vysledky: vysledky.map((v) => ({ stav: v.stav, nalezeno: v.nalezeno, zapsano: v.zapsano, existuje: v.existuje, kontrola: v.kontrola, zbyva: v.zbyva, schrankaDoctena: v.schrankaDoctena })),
  })
}
