'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { adresaCloveka, JE_UUID, naOdkud, platnyDen, platnyMesic, type Odkud } from '@/lib/useky-dochazky'

/**
 * Úprava a storno úseku docházky — obrazovka Docházka člověka a boční
 * panel živého přehledu.
 *
 * Tady se NIC NEROZHODUJE o pravidlech: pořadí, 24 h, provozní den,
 * překryv, párování, práva na pobočce záznamu i „vlastní jen majitel"
 * drží databáze (`public.upravit_usek_dochazky`,
 * `public.stornovat_usek_dochazky`), jedna transakce, nic se nemaže.
 * Akce jen převede formulář na parametry a hlášku z databáze propustí
 * BEZE ZMĚNY (vzor rucni.ts) — je česká a ví, co se stalo.
 *
 * První obranná linie: attendance.manage v rozsahu z adresy
 * (`zkusPristup`). Druhá: databáze na pobočce každého záznamu.
 *
 * ČAS JDE DO DATABÁZE TAK, JAK HO ČLOVĚK NAPSAL: „2026-09-25T21:40",
 * hodina na zdi bez pásma. Pásmo dodá pobočka záznamu uvnitř funkce.
 * Nikdy `new Date('…T21:40')` — server na Vercelu je v UTC a směna by
 * vyšla o dvě hodiny jinak (pravidlo 11).
 *
 * Kam se vrátit, je výčet, ne adresa: z formuláře jde jen id člověka,
 * měsíc a „odkud", a z nich se adresa poskládá tady. Kdyby se posílala
 * celá adresa, dal by se člověk po uložení poslat kamkoli.
 */

type Navrat = {
  rozsah: string
  zamestnanec: string
  mesic: string | null
  odkud: Odkud | null
  den: string | null
  /** 'prehled' = zpět do bočního panelu živého přehledu. */
  doPrehledu: boolean
}

function navrat(formData: FormData): Navrat {
  return {
    rozsah: String(formData.get('rozsah') ?? ''),
    zamestnanec: String(formData.get('zamestnanec') ?? ''),
    mesic: platnyMesic(String(formData.get('mesic') ?? '')),
    odkud: naOdkud(String(formData.get('z') ?? '')),
    den: platnyDen(String(formData.get('den') ?? '')),
    doPrehledu: String(formData.get('zpet') ?? '') === 'prehled',
  }
}

/** Adresa obrazovky člověka s výsledkem a kotvou na den. */
function zpetNaCloveka(n: Navrat, vysledek: Record<string, string>): string {
  const zaklad = adresaCloveka(n.rozsah, n.zamestnanec, { mesic: n.mesic, odkud: n.odkud })
  const q = new URLSearchParams(vysledek).toString()
  const kotva = n.den ? `#den-${n.den}` : ''
  return `${zaklad}${zaklad.includes('?') ? '&' : '?'}${q}${kotva}`
}

/** Zpět do živého přehledu s otevřeným panelem toho člověka. */
function zpetDoPrehledu(n: Navrat, vysledek: Record<string, string>): string {
  const q = new URLSearchParams({ osoba: n.zamestnanec, ...vysledek }).toString()
  return `/${n.rozsah}/dochazka?${q}`
}

/** „2026-09-25" + „21:40" → „2026-09-25T21:40"; cokoli jiného → null. */
function hodinaNaZdi(datum: FormDataEntryValue | null, cas: FormDataEntryValue | null): string | null {
  const d = String(datum ?? '').trim()
  const c = String(cas ?? '').trim()
  if (!d && !c) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(c)) return 'neplatne'
  return `${d}T${c}`
}

function uuidNeboNull(v: FormDataEntryValue | null): string | null | 'neplatne' {
  const s = String(v ?? '').trim()
  if (!s) return null
  return JE_UUID.test(s) ? s : 'neplatne'
}

async function zacatek(n: Navrat): Promise<string> {
  if (!JE_UUID.test(n.zamestnanec)) redirect(`/${n.rozsah}/dochazka`)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'attendance.manage', n.rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav !== 'ok') {
    const text = 'Upravovat docházku smí jen ten, kdo ji spravuje.'
    redirect(
      n.doPrehledu
        ? zpetDoPrehledu(n, { storno: 'chyba', text })
        : zpetNaCloveka(n, { chyba: 'uprava', text, ...(n.den ? { den: n.den } : {}) }),
    )
  }
  return tenantId
}

/**
 * Úprava úseku, doplnění odchodu nebo příchodu, nový úsek — podle toho,
 * která id formulář poslal (viz hlavička `upravit_usek_dochazky`).
 */
export async function upravitUsek(formData: FormData): Promise<void> {
  const n = navrat(formData)
  const tenantId = await zacatek(n)

  const prichodId = uuidNeboNull(formData.get('prichod_id'))
  const odchodId = uuidNeboNull(formData.get('odchod_id'))
  const prichodPobocka = uuidNeboNull(formData.get('prichod_pobocka'))
  const odchodPobocka = uuidNeboNull(formData.get('odchod_pobocka'))
  const prichodKdy = hodinaNaZdi(formData.get('prichod_datum'), formData.get('prichod_cas'))
  // „Bez odchodu (ještě v práci)" — odchod se vůbec neposílá.
  const bezOdchodu = String(formData.get('bez_odchodu') ?? '') === '1'
  const odchodKdy = bezOdchodu ? null : hodinaNaZdi(formData.get('odchod_datum'), formData.get('odchod_cas'))
  const duvod = String(formData.get('duvod') ?? '').trim()

  if ([prichodId, odchodId, prichodPobocka, odchodPobocka, prichodKdy, odchodKdy].includes('neplatne')) {
    redirect(
      zpetNaCloveka(n, {
        chyba: 'uprava',
        text: 'Datum nebo čas nejde přečíst. Vyplňte obojí ve tvaru den a hodina.',
        ...(n.den ? { den: n.den } : {}),
      }),
    )
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('upravit_usek_dochazky', {
    p_tenant: tenantId,
    p_employee: n.zamestnanec,
    p_prichod: prichodId,
    p_odchod: odchodId,
    // Hodina na zdi, bez převodu — viz hlavička.
    p_prichod_kdy: prichodKdy,
    p_prichod_pobocka: prichodPobocka,
    p_odchod_kdy: odchodKdy,
    p_odchod_pobocka: bezOdchodu ? null : odchodPobocka,
    p_duvod: duvod,
  })

  if (error) {
    redirect(zpetNaCloveka(n, { chyba: 'uprava', text: error.message, ...(n.den ? { den: n.den } : {}) }))
  }

  // Den výsledku říká databáze (u nového úseku ho formulář neví jistě).
  // A s ním i MĚSÍC: úsek zapsaný 1. 10. na 30. 9. se musí ukázat na
  // zářijové stránce, jinak by uložení nemělo žádnou odezvu a druhý
  // pokus by skončil „překryvem" s tím prvním.
  const den = platnyDen(String((data as { den?: string }[] | null)?.[0]?.den ?? '')) ?? n.den
  revalidatePath(`/${n.rozsah}/dochazka`)
  redirect(zpetNaCloveka(naDen(n, den), den ? { ulozeno: den } : { ulozeno: '1' }))
}

/** Návrat na den výsledku — i s jeho měsícem (RRRR-MM z provozního dne). */
function naDen(n: Navrat, den: string | null): Navrat {
  return { ...n, den, mesic: den ? den.slice(0, 7) : n.mesic }
}

/**
 * Storno úseku nebo jednoho nezapočítaného záznamu — typicky příchod
 * píchnutý omylem. Nic se nemaže; databáze odmítne storno, které by
 * přepárovalo ostatní záznamy dne.
 */
export async function stornovatUsek(formData: FormData): Promise<void> {
  const n = navrat(formData)
  const tenantId = await zacatek(n)

  const prichodId = uuidNeboNull(formData.get('prichod_id'))
  const odchodId = uuidNeboNull(formData.get('odchod_id'))
  const duvod = String(formData.get('duvod') ?? '').trim()

  if (prichodId === 'neplatne' || odchodId === 'neplatne' || (!prichodId && !odchodId)) {
    const text = 'Není jasné, co stornovat. Obnovte stránku.'
    redirect(
      n.doPrehledu
        ? zpetDoPrehledu(n, { storno: 'chyba', text })
        : zpetNaCloveka(n, { chyba: 'uprava', text, ...(n.den ? { den: n.den } : {}) }),
    )
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('stornovat_usek_dochazky', {
    p_tenant: tenantId,
    p_employee: n.zamestnanec,
    p_prichod: prichodId,
    p_odchod: odchodId,
    p_duvod: duvod,
  })

  if (error) {
    redirect(
      n.doPrehledu
        ? zpetDoPrehledu(n, { storno: 'chyba', text: error.message })
        : zpetNaCloveka(n, { chyba: 'uprava', text: error.message, ...(n.den ? { den: n.den } : {}) }),
    )
  }

  const den = platnyDen(String((data as { den?: string }[] | null)?.[0]?.den ?? '')) ?? n.den
  revalidatePath(`/${n.rozsah}/dochazka`)
  redirect(
    n.doPrehledu
      ? zpetDoPrehledu(n, { storno: 'ok' })
      : zpetNaCloveka(naDen(n, den), den ? { stornovano: den } : { stornovano: '1' }),
  )
}
