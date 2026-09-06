'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Zápis příchodu nebo odchodu KÓDEM Z KIOSKU.
 *
 * Do 1. 9. 2026 tahle akce zapisovala do docházky přímo. Znamenalo to,
 * že si zaměstnanec mohl přímým voláním rozhraní založit příchod
 * k 1. červenci ve 3:00 — a nebyl nijak označený, protože formálně šlo
 * o řádné píchnutí. Dokud byla docházka evidence, byla to drobnost;
 * teď se z ní počítá mzda a zálohy.
 *
 * Od téhle chvíle smí píchnutí vzniknout jen třemi cestami (zadání
 * docs/kiosek-pin-zalohy-zadani.md, oddíl 5):
 *
 *   měnící se kód  — tahle akce
 *   PIN na kiosku  — public.pichnout_pinem
 *   ruční zadání   — attendance.manage, s důvodem a auditem
 *
 * Čas si tedy nikdo nevybírá: zapisuje se „teď“ a rozhoduje o tom
 * databáze, ne prohlížeč.
 */
export async function zapsatDochazku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const druh = String(formData.get('druh') ?? '')
  const kod = String(formData.get('kod') ?? '').trim()

  /*
    Přišel kód z QR, nebo ho někdo opsal?

    Rozlišuje to JEN HLÁŠKU, nic jiného. Kód se ověřuje stejně
    v obou případech — že přišel z adresy, na tom nemění nic
    (docs/qr-na-kiosku-zadani.md: „kód z adresy je návrh, ne
    oprávnění“).

    Kdo naskenoval a nestihl ťuknout, má jít k tabletu pro nový kód.
    Kdo se překlepl při opisování, má zkusit znovu. Jedna věta by
    polovinu lidí posílala špatným směrem.
  */
  const zQr = String(formData.get('zqr') ?? '') === '1'

  /*
    KAM SE PO PÍCHNUTÍ VRÁTIT.

    Píchá se ze dvou obrazovek — z Docházky a z Dnes — ale CESTA DO
    DATABÁZE JE JEDNA. Druhá cesta by znamenala druhé místo, kde se
    dá zapomenout na kód nebo na hlášku o uzavřeném příchodu.

    Hodnota se nebere z formuláře volně: je to výčet, ne cesta. Kdyby
    se posílala celá adresa, dal by se člověk po píchnutí poslat kamkoli.
  */
  const zpet =
    String(formData.get('zpet') ?? '') === 'dnes' ? 'dnes' : 'dochazka'

  if (druh !== 'in' && druh !== 'out') return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  if (!kod) {
    redirect(`/${rozsah}/${zpet}?chyba=kod`)
  }

  const supabase = await getServerSupabase()

  // Pobočka se NEPOSÍLÁ. Vyplyne z kódu — ten patří jedné konkrétní
  // pobočce a jinde neplatí. Kdyby šla poslat z prohlížeče, dal by se
  // kód z jedné provozovny použít na druhé.
  const { data, error } = await supabase.rpc('pichnout_kodem', {
    p_tenant: tenantId,
    p_kod: kod,
    p_druh: druh,
  })

  if (error) {
    /*
      Neplatný kód po naskenování skoro vždycky znamená, že mezi
      naskenováním a ťuknutím uplynulo víc než 45 vteřin — u někoho,
      kdo si musí odemknout telefon, docela snadno.

      Obrazovka pak nesmí říct „nepovedlo se“. Člověk musí vědět, že má
      jít k tabletu, ne že je rozbitá aplikace.
    */
    const vyprselo = zQr && error.code === '22023'
    redirect(
      vyprselo
        ? `/${rozsah}/${zpet}?chyba=kod-vyprsel`
        : `/${rozsah}/${zpet}?chyba=pichnuti&text=${encodeURIComponent(error.message)}`,
    )
  }

  /*
    UZAVŘENÝ STARÝ PŘÍCHOD SE NESMÍ ZAMLČET.

    Když měl člověk otevřený příchod ze staršího provozního dne,
    `pichnout_kodem` ho uzavřela a dala o tom vědět vedoucímu
    (20260905010000). Člověk to má vědět taky — jinak mu aplikace za
    zády uklidila jeho vlastní záznam a on se to nedozví.

    `stary_den` jde do adresy jako datum, ne jako hotová věta: text
    patří na obrazovku, ne do serverové akce.
  */
  const r = (data as { uzavren_stary: boolean; stary_den: string | null }[] | null)?.[0]

  revalidatePath(`/${rozsah}/${zpet}`)
  redirect(
    r?.uzavren_stary && r.stary_den
      ? `/${rozsah}/${zpet}?pichnuto=${druh}&uzavreno=${r.stary_den}`
      : `/${rozsah}/${zpet}?pichnuto=${druh}`,
  )
}
