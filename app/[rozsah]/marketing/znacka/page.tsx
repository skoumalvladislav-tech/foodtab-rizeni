import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { jeden, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { ulozitZnacku } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Značka provozovny — barvy, písmo, podpis, tón hlasu.
 *
 * Zadání: docs/marketing-je-modul.md.
 *
 * Rozsah se řídí adresou: na pobočce se ukládá značka pobočky, na
 * firemní úrovni firemní. Pobočková přebíjí firemní — rozhoduje o tom
 * `public.marketing_znacka` v databázi, ne tahle obrazovka.
 *
 * Prázdné pole znamená „nezadáno", ne prázdná hodnota. Návrh si to
 * nedomýšlí: co tu není, do příspěvku nepatří.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

const pole = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '14px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

type Znacka = {
  ton_hlasu: string
  pouzivat_emoji: boolean
  barva_hlavni: string | null
  barva_doplnkova: string | null
  pismo_nadpisy: string | null
  pismo_text: string | null
  podpis: string
  kontakt: string
  vyrazy_ano: string[]
  vyrazy_ne: string[]
  video_sekundy: number
}

export default async function ZnackaStranka({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ ulozeno?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { ulozeno, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Marketing není zapnutý">
        Modul si firma zapíná zvlášť. Pokud ho firma má, chybí vám k němu
        oprávnění.
      </Sdeleni>
    )
  }

  const branchId = pristup.scope.branchId
  const supabase = await getServerSupabase()

  const dotaz = branchId === null
    ? supabase.from('marketing_nastaveni')
        .select('ton_hlasu, pouzivat_emoji, barva_hlavni, barva_doplnkova, pismo_nadpisy, pismo_text, podpis, kontakt, vyrazy_ano, vyrazy_ne, video_sekundy')
        .eq('tenant_id', tenantId).is('branch_id', null).maybeSingle()
    : supabase.from('marketing_nastaveni')
        .select('ton_hlasu, pouzivat_emoji, barva_hlavni, barva_doplnkova, pismo_nadpisy, pismo_text, podpis, kontakt, vyrazy_ano, vyrazy_ne, video_sekundy')
        .eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle()

  const odpoved = await dotaz
  if (tabulkaNeexistuje(odpoved.error)) {
    return (
      <>
        <Nadpis oci="Marketing">Značka</Nadpis>
        <div style={{ padding: '16px' }}>
          <Sdeleni nadpis="Čeká se na nasazení databáze">
            Tabulky modulu zatím nejsou nasazené. Až proběhnou migrace,
            obrazovka se rozjede sama.
          </Sdeleni>
        </div>
      </>
    )
  }

  const z = await jeden<Znacka>('značka provozovny', Promise.resolve(odpoved))

  // Kdo smí jen číst, vidí totéž, ale nemůže uložit. Skrytý formulář by
  // byl horší: člověk by nevěděl, proč to nejde.
  const smiMenit = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'

  const kdeJsme = pristup.scope.branchName ?? 'celá firma'

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis={
          branchId === null
            ? 'Firemní značka. Pobočka si ji může přebít vlastní.'
            : `Značka provozovny ${kdeJsme}. Co tu nevyplníte, se vezme z firemní.`
        }
      >
        Značka
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '760px', display: 'grid', gap: '16px' }}>
        {ulozeno ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Uloženo.</p>
        ) : null}
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        <form action={ulozitZnacku} style={{ ...karta, display: 'grid', gap: '16px' }}>
          <input type="hidden" name="rozsah" value={rozsah} />

          <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <label>
              <span style={popisek}>Tón hlasu</span>
              <select name="ton_hlasu" defaultValue={z?.ton_hlasu ?? 'neformalni'} style={pole} disabled={!smiMenit}>
                <option value="formalni">Formální — vykáme, bez nadsázky</option>
                <option value="neformalni">Neformální — vykáme, ale lidsky</option>
                <option value="hrave">Hravý — nadsázka, kratší věty</option>
              </select>
            </label>

            <label>
              <span style={popisek}>Emoji v textu</span>
              <select name="pouzivat_emoji" defaultValue={(z?.pouzivat_emoji ?? true) ? 'ano' : 'ne'} style={pole} disabled={!smiMenit}>
                <option value="ano">Používat</option>
                <option value="ne">Nepoužívat</option>
              </select>
            </label>

            <label>
              <span style={popisek}>Hlavní barva</span>
              <input name="barva_hlavni" defaultValue={z?.barva_hlavni ?? ''} placeholder="#7a1f2b" style={pole} disabled={!smiMenit} />
            </label>

            <label>
              <span style={popisek}>Doplňková barva</span>
              <input name="barva_doplnkova" defaultValue={z?.barva_doplnkova ?? ''} placeholder="#d8ab4e" style={pole} disabled={!smiMenit} />
            </label>

            <label>
              <span style={popisek}>Písmo nadpisů</span>
              <input name="pismo_nadpisy" defaultValue={z?.pismo_nadpisy ?? ''} placeholder="Newsreader" style={pole} disabled={!smiMenit} />
            </label>

            <label>
              <span style={popisek}>Písmo textu</span>
              <input name="pismo_text" defaultValue={z?.pismo_text ?? ''} placeholder="Archivo" style={pole} disabled={!smiMenit} />
            </label>
          </div>

          <label>
            <span style={popisek}>Podpis pod příspěvkem</span>
            <input name="podpis" defaultValue={z?.podpis ?? ''} placeholder="Černá Perla" style={pole} disabled={!smiMenit} />
          </label>

          <label>
            <span style={popisek}>Kontakt do patičky obrázku</span>
            <input name="kontakt" defaultValue={z?.kontakt ?? ''} placeholder="Náměstí 1, Tábor · 777 123 456" style={pole} disabled={!smiMenit} />
          </label>

          <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label>
              <span style={popisek}>Výrazy, které používáme (oddělené čárkou)</span>
              <input name="vyrazy_ano" defaultValue={(z?.vyrazy_ano ?? []).join(', ')} placeholder="poctivé, domácí, sezónní" style={pole} disabled={!smiMenit} />
            </label>

            <label>
              <span style={popisek}>Výrazy, kterým se vyhýbáme</span>
              <input name="vyrazy_ne" defaultValue={(z?.vyrazy_ne ?? []).join(', ')} placeholder="levné, akce, mňam" style={pole} disabled={!smiMenit} />
            </label>
          </div>

          <label style={{ maxWidth: '220px' }}>
            <span style={popisek}>Délka videa v sekundách (3–90)</span>
            <input name="video_sekundy" type="number" min={3} max={90} defaultValue={z?.video_sekundy ?? 20} style={pole} disabled={!smiMenit} />
          </label>

          {smiMenit ? (
            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Uložit značku</button>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Značku mění ten, kdo smí připravovat příspěvky. Vy ji vidíte,
              ale neuložíte.
            </p>
          )}
        </form>

        <p style={{ margin: 0, fontSize: '13px' }}>
          <Link href={`/${rozsah}/marketing`}>Zpět na Marketing</Link>
        </p>
      </div>
    </>
  )
}
