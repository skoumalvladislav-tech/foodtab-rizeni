import { getUser, hasAccess, type Context, type Scope } from '@/lib/authz'
import { jeProMe, seraditOznameni, type CtenarNastenky } from '@/lib/komunikace/nastenka'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import FormularOznameni from './formular-oznameni'
import { ctenariNastenky, dotazNastenky, nactiCtenare } from './nastenka-dotaz'
import SeznamOznameni, { type OznameniUI } from './seznam-oznameni'

/**
 * Nástěnka — záložka „Vzkazy a úkoly“.
 *
 * JE TO JEN OBSAH, ne celá obrazovka. Přihlášení, rozsah i nadpis řeší
 * `vzkazy/page.tsx`; sem se předá hotový kontext.
 *
 * SLOUČIL SE VCHOD, NE OBSAH. Nástěnka zůstává tím, čím byla:
 * jednosměrné sdělení „tohle vědí všichni", na které se neodpovídá
 * a u kterého se eviduje, kdo ho vzal na vědomí. Vzkazy jsou naopak
 * rozhovor. Dva různé tvary pod jednou položkou v nabídce.
 *
 * Co na Nástěnku patří (pokyny, řády, akce, fotky z provozu) a co ne
 * (osobní dokumenty lidí), stojí od 27. 9. i u tabulky v databázi
 * (`comment on table public.announcements`, volba Šéfíka 6. 9.).
 *
 * POŘADÍ (27. 9., zadání 5., 6. a 8. 9.): nahoře oznámení, která čekají
 * na moje „Beru na vědomí“, od nejstaršího; pak připnutá; pak ostatní od
 * nejnovějšího. Skládá ho čistá funkce `seraditOznameni` s testem.
 * „Čeká na mě“ jen u oznámení PRO MĚ (28. 9., `jeProMe`, stejná
 * pravidla jako upozornění): ne vlastní, ne cizímu úseku.
 *
 * Přečtení se eviduje na kliknutí, ne při vykreslení: zápis do databáze
 * jen proto, že si někdo otevřel stránku, by byl vedlejší účinek, který
 * do vykreslování nepatří.
 */

type Oznameni = OznameniUI

export default async function Nastenka({
  tenantId,
  ctx,
  scope,
  rozsah,
}: {
  tenantId: string
  ctx: Context
  scope: Scope
  rozsah: string
}) {
  /*
    NÁSTĚNKA VISÍ NA `communication.read`, ROZHOVORY NE.

    Po sloučení pod jeden vchod se to nesmí ztratit. Kdyby se to
    právo vyžadovalo na celé obrazovce, nedostal by se do Vzkazů
    číšník, který ho v roli nemá — a přišel by tím i o vlastní
    vlákno. Kdyby se naopak nevyžadovalo nikde, četl by nástěnku
    i ten, komu ji firma zavřela.

    Záložka se bez práva od 27. 9. nekreslí (`skryteZalozky`); sem se
    dostane jen přímou adresou, a tak je odpovědí vysvětlení, ne prázdno.
  */
  const smiCist = await hasAccess(tenantId, 'communication.read', scope.branchId)
  if (!smiCist) {
    return (
      <Sdeleni nadpis="Na nástěnku nedosáhnete">
        Vaše oprávnění nástěnku neotvírá. Pokud si myslíte, že by mělo,
        řekněte si správci firmy o úpravu oprávnění. Vzkazy vám
        zůstávají.
      </Sdeleni>
    )
  }

  const muzePsat = await hasAccess(tenantId, 'communication.manage', scope.branchId)

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const user = await getUser()
  const supabase = await getServerSupabase()

  // TÝŽ dotaz jako číslo u záložky a ve zvonečku (`dotazNastenky`).
  const { data: zpravyData, error: chybaZpravyData } = await dotazNastenky(
    supabase,
    tenantId,
    scope.branchId,
    'id, branch_id, employee_id, usek_id, position_id, body, pinned, author_id, created_at, requires_acknowledgment',
  )
  if (chybaZpravyData) throw new DotazSelhal('oznámení na nástěnce', chybaZpravyData)
  const nactene = (zpravyData ?? []) as unknown as Oznameni[]

  // Co už mám přečtené. Politika pustí jen vlastní řádky, takže se
  // nemusí filtrovat podle user_id znovu — ale je to levné a čitelné.
  const prectene = new Set<string>()
  if (nactene.length > 0 && user) {
    const { data: cteni, error: chybaCteni } = await supabase
      .from('announcement_reads')
      .select('announcement_id')
      .eq('user_id', user.id)
      .in(
        'announcement_id',
        nactene.map((z) => z.id),
      )
    if (chybaCteni) throw new DotazSelhal('přečtená oznámení', chybaCteni)
    for (const c of cteni ?? []) prectene.add(c.announcement_id as string)
  }

  // Co je PRO MĚ (28. 9.): jen to čeká na moje potvrzení a jen u toho
  // je tlačítko. Vlastní oznámení a oznámení pro jiné úseky, pozice
  // a lidi (vedoucímu je pustí RLS) se ukážou bez štítku a bez tlačítka.
  const ja: CtenarNastenky = user
    ? await nactiCtenare(supabase, tenantId, user.id)
    : { userId: '', employeeId: null, branchId: null, usekId: null, positionId: null }
  const zpravy = seraditOznameni(nactene, prectene, ja)
  const proMe = zpravy.filter((z) => jeProMe(z, ja)).map((z) => z.id)

  // Jména autorů. Politika profiles_select_colleagues pouští profily lidí
  // ze stejné firmy, takže dotaz projde; kdo se nenajde, zůstane bez jména.
  const autori = new Map<string, string>()
  const idAutoru = [...new Set(zpravy.map((z) => z.author_id).filter((i): i is string => Boolean(i)))]
  if (idAutoru.length > 0) {
    const { data: profily, error: chybaProfily } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .in('user_id', idAutoru)
    if (chybaProfily) throw new DotazSelhal('profily lidí', chybaProfily)
    for (const p of profily ?? []) {
      const jmeno = String(p.full_name ?? '').trim()
      if (jmeno !== '') autori.set(p.user_id as string, jmeno)
    }
  }

  // Kdo nepotvrdil — vidí jen vedoucí u oznámení s povinným potvrzením.
  // announcement_reads má RLS jen na vlastní řádky; RPC kdo_nepotvrdil
  // je SECURITY DEFINER a RLS obejde (pravidlo 7b).
  const nepotvrdiliMap = new Map<string, string[]>()
  if (muzePsat) {
    const vyzadujiciIds = zpravy.filter((z) => z.requires_acknowledgment).map((z) => z.id)
    if (vyzadujiciIds.length > 0) {
      const vysledky = await Promise.all(
        vyzadujiciIds.map((id) =>
          supabase
            .rpc('kdo_nepotvrdil', { p_tenant: tenantId, p_announcement: id })
            .then((r) => ({ id, data: (r.data ?? []) as { jmeno: string }[] })),
        ),
      )
      for (const { id, data } of vysledky) {
        if (data.length > 0) nepotvrdiliMap.set(id, data.map((d) => d.jmeno))
      }
    }
  }

  // Úseky a pozice — pro popisky v seznamu i pro výběr adresáta.
  type UsekRow = { id: string; nazev: string; branch_id: string | null }
  type PoziceRow = { id: string; label: string }
  type ZamRow = { id: string; full_name: string | null }

  const [usekyRes, poziceRes] = await Promise.all([
    supabase.from('useky').select('id, nazev, branch_id').eq('tenant_id', tenantId).eq('active', true).order('poradi'),
    supabase.from('positions').select('id, label').eq('tenant_id', tenantId).eq('active', true).order('label'),
  ])
  const usekyList = (usekyRes.data ?? []) as UsekRow[]
  const poziceList = (poziceRes.data ?? []) as PoziceRow[]

  /*
    „Konkrétní člověk“ nabízí jen lidi S ÚČTEM (27. 9.), kteří Nástěnku
    SMÍ ČÍST (28. 9.). Nástěnka se čte po přihlášení a jen s
    `communication.read` — oznámení komukoli jinému by nikdy nikdo
    neuviděl (a od T9 by na něj nepřišlo ani upozornění), a autor by si
    myslel, že ho předal. Právo jiného člověka zná jen databáze
    (`ctenari_nastenky`); bez ní (migrace ještě není) zůstane seznam
    lidí s účtem jako dosud.
  */
  let lideList: ZamRow[] = []
  if (muzePsat) {
    const zamRes = await supabase
      .from('employees')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .not('user_id', 'is', null)
      .order('full_name')
    lideList = (zamRes.data ?? []) as ZamRow[]
    const ctenari = await ctenariNastenky(
      supabase,
      tenantId,
      lideList.map((e) => e.id),
    )
    if (ctenari.stav === 'ok') lideList = lideList.filter((e) => ctenari.ids.has(e.id))
    // Chyba dotazu = nikoho nenabízet: radši žádná volba než volba, která tiše nedojde.
    if (ctenari.stav === 'chyba') lideList = []
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  /*
    Vlastní `<Nadpis>` tu SCHVÁLNĚ NENÍ — kreslí ho stránka nad záložkami.
    Dva nadpisy pod sebou by z jedné obrazovky udělaly dvě.
  */
  return (
    <div className="pc-nastenka">
      {muzePsat ? (
        <FormularOznameni
          rozsah={rozsah}
          pobocky={ctx.branches.map((b) => ({ id: b.id, nazev: b.name }))}
          useky={usekyList.map((u) => ({ id: u.id, nazev: u.nazev }))}
          pozice={poziceList.map((p) => ({ id: p.id, nazev: p.label }))}
          lide={lideList.map((e) => ({ id: e.id, nazev: String(e.full_name ?? '').trim() || '(bez jména)' }))}
        />
      ) : null}

      <SeznamOznameni
        rozsah={rozsah}
        zpravy={zpravy}
        prectene={[...prectene]}
        proMe={proMe}
        autori={Object.fromEntries(autori)}
        useky={Object.fromEntries(usekyList.map((u) => [u.id, u.nazev]))}
        pozice={Object.fromEntries(poziceList.map((p) => [p.id, p.label]))}
        pobocky={Object.fromEntries(ctx.branches.map((b) => [b.id, b.name]))}
        naFiremniUrovni={scope.level === 'tenant'}
        muzePsat={muzePsat}
        nepotvrdili={Object.fromEntries(nepotvrdiliMap)}
      />
    </div>
  )
}
