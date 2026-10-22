import { redirect } from 'next/navigation'
import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { seznam, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { odvolatZarizeni, prepnoutKiosekJinychPlateb } from './akce'
import FormularKodu from './formular'

export const dynamic = 'force-dynamic'

/**
 * Nastavení → Zařízení
 *
 * Tablety a telefony na provozovně. Zadání
 * docs/kiosek-pin-zalohy-zadani.md, oddíl 2: kiosek je ZAŘÍZENÍ
 * pobočky, ne přihlášený člověk.
 *
 * Klíč zařízení tady není a být nemůže — v databázi je jen jeho otisk
 * a čtení sloupce je aplikaci odebrané. Kdo klíč ztratí, zaregistruje
 * tablet znovu.
 */

type Zarizeni = {
  id: string
  branch_id: string
  nazev: string
  stav: string
  revoked_at: string | null
  posledni_kdy: string | null
  created_at: string
}

export default async function NastaveniZarizeni({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; odvolano?: string; kiosek?: string }>
}) {
  const { rozsah } = await params
  const { chyba, odvolano, kiosek } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Zařízení pobočky spravuje ten, kdo má právo <code>settings.manage</code>.
      </Sdeleni>
    )
  }

  const { ctx, scope } = pristup
  const supabase = await getServerSupabase()

  const dotaz = supabase
    .from('branch_devices')
    .select('id, branch_id, nazev, stav, revoked_at, posledni_kdy, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  const { data, error } = scope.branchId
    ? await dotaz.eq('branch_id', scope.branchId)
    : await dotaz

  if (tabulkaNeexistuje(error)) {
    return (
      <>
        <Nadpis oci="Nastavení" popis="Tablety a telefony na provozovně.">
          Zařízení
        </Nadpis>
        <div style={{ padding: '16px' }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong>{' '}
            Zařízení přibudou migrací <code>20260901170000_zarizeni_pobocky</code>.
          </p>
        </div>
      </>
    )
  }
  if (error) throw error

  const zarizeni = (data ?? []) as Zarizeni[]

  // Kiosek Jiných plateb (migrace 20261022100000). Před nasazením tabulka není — přepínač se pak neukáže.
  const kiosky = await supabase.from('jine_platby_kiosky').select('zarizeni_id').eq('tenant_id', tenantId)
  const kioskyNasazene = !kiosky.error
  if (kiosky.error && !tabulkaNeexistuje(kiosky.error)) throw kiosky.error
  const sKioskem = new Set(((kiosky.data ?? []) as { zarizeni_id: string }[]).map((k) => k.zarizeni_id))
  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]))

  // Na pobočkové adrese se registruje na tu pobočku, na firemní se
  // vybírá. Kiosek se váže na místo, ne na firmu.
  const pobocky = scope.branchId
    ? [{ id: scope.branchId, nazev: scope.branchName ?? '' }]
    : ctx.branches.map((b) => ({ id: b.id, nazev: b.name }))

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Tablet na provozovně je zařízení pobočky, ne přihlášený člověk. Na baru nemá ležet účet, který vidí mzdy."
      >
        Zařízení
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '760px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}
        {kiosek ? (
          <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--dobre)' }}>
            {kiosek === 'zapnut'
              ? 'Kiosek Jiných plateb zapnutý. Na zařízení otevřete adresu /kiosek/doklady.'
              : 'Kiosek Jiných plateb vypnutý. Od téhle chvíle z něj doklad neodejde.'}
          </p>
        ) : null}
        {odvolano ? (
          <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--dobre)' }}>
            Zařízení odvoláno. Od téhle chvíle neukáže kód ani nepíchne.
          </p>
        ) : null}

        {pobocky.length > 0 ? (
          <FormularKodu rozsah={rozsah} pobocky={pobocky} />
        ) : null}

        <h2 style={{ margin: '24px 0 12px', fontSize: '16px', color: 'var(--muted)', fontWeight: 500 }}>
          {zarizeni.length === 0 ? 'Zatím žádné zařízení' : 'Zaregistrovaná zařízení'}
        </h2>

        {zarizeni.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            Dokud tu žádné není, nemá se kde ukazovat kód k píchnutí — lidé
            si tedy zapíšou docházku jedině přes vedoucího.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px' }}>
            {zarizeni.map((z) => (
              <li
                key={z.id}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  opacity: z.stav === 'active' ? 1 : 0.6,
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ minWidth: 0, flex: '1 1 240px' }}>
                  <strong style={{ fontSize: '15px' }}>{z.nazev}</strong>
                  <span style={{ display: 'block', fontSize: '13px', color: 'var(--muted)' }}>
                    {nazvyPobocek.get(z.branch_id) ?? '—'}
                    {z.stav === 'active'
                      ? z.posledni_kdy
                        ? ` · naposled ${kdy(z.posledni_kdy)}`
                        : ' · zatím nepoužité'
                      : ` · odvoláno ${kdy(z.revoked_at)}`}
                  </span>
                </span>

                {z.stav === 'active' && kioskyNasazene ? (
                  <form action={prepnoutKiosekJinychPlateb} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="zarizeni" value={z.id} />
                    <input type="hidden" name="zapnout" value={sKioskem.has(z.id) ? 'ne' : 'ano'} />
                    <span style={{ fontSize: '13px', color: sKioskem.has(z.id) ? 'var(--dobre)' : 'var(--muted)' }}>
                      Kiosek Jiných plateb: {sKioskem.has(z.id) ? 'zapnutý' : 'vypnutý'}
                    </span>
                    <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      {sKioskem.has(z.id) ? 'Vypnout' : 'Zapnout'}
                    </button>
                  </form>
                ) : null}

                {z.stav === 'active' ? (
                  <form action={odvolatZarizeni}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="zarizeni" value={z.id} />
                    <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      Odvolat
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <p style={{ margin: '20px 0 0', fontSize: '13px', color: 'var(--muted)', maxWidth: '62ch' }}>
          Telefon na provozovně se páruje stejně jako tablet: vystavte kód, na telefonu otevřete{' '}
          <code>/kiosek/doklady</code> a kód opište. Pak u něj zapněte <strong>Kiosek Jiných plateb</strong> — obsluha jím
          vyfotí účet a doklad přijde do Finance → Tržby → Jiné platby. Nic jiného z telefonu vidět není.
        </p>
        <p style={{ margin: '12px 0 0', fontSize: '13px', color: 'var(--muted)', maxWidth: '62ch' }}>
          Odvolané zařízení se nemaže — ať je dohledatelné, co na
          provozovně kdy bylo. Ztracený tablet stačí odvolat tady;
          nikde jinde se nic měnit nemusí.
        </p>
      </div>
    </>
  )
}

/*
  Pásmo se dodává vždycky. Bez něj bere JavaScript pásmo serveru — na
  Vercelu UTC — a čas je v létě o dvě hodiny vedle. Viz lib/cas.ts.
*/
function kdy(iso: string | null, zona?: string): string {
  if (!iso) return ''
  return datumACasVPasmu(iso, zona ?? ZONA_VYCHOZI)
}

const ramecek = {
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '14px',
} as const
