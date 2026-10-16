import { randomUUID } from 'node:crypto'

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { pobockySPravem, zkusPristupJinymPlatbam } from '@/lib/jine-platby-pristup'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import EmptyState from '@/components/ui/EmptyState'
import Ikona from '../../../../ikona'
import Nadpis from '../../../../nadpis'
import Navigace from '../../../navigace'
import FormularNovehoZaznamu, { type PobockaVolba } from './formular'

export const dynamic = 'force-dynamic'

/**
 * Jiné platby → nový záznam (krok 1 průvodce).
 *
 * Vstup přes `zkusPristupJinymPlatbam`, ne `zkusPristupFinanci`: záznam
 * zakládá obsluha, která finanční přehled nemá (lib/jine-platby-pristup.ts).
 * Na pobočce je provozovna daná adresou; za celou firmu se nabídnou jen
 * pobočky, kde `has_access(…, 'jine_platby.zadat', pobočka)` řekne ano —
 * ptá se databáze na každou zvlášť.
 *
 * Pokladny provozovny vrací `jine_platby_pokladny` (SECURITY DEFINER,
 * jen netajné údaje, jen s právem agendy NA té pobočce). Přímo
 * `integrace_pripojeni` čte přes RLS jen finanční přehled — obsluha by
 * žádnou pokladnu neviděla a záznam by nešel vydat ze skladu.
 */
export default async function NovyZaznamJinePlatby({ params }: { params: Promise<{ rozsah: string }> }) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristupJinymPlatbam(tenantId, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Jiné platby vidí ten, kdo má některé z práv Jiných plateb nebo „Vidět finanční přehled“.</Sdeleni>
  }
  // `null` = celá firma (výběr provozovny); jinak pobočka z adresy.
  const pobockaRozsahu = pobockaFinanci(pristup.scope)
  const zpet = `/${rozsah}/finance/trzby/jine-platby`

  if (!pristup.prava.has('jine_platby.zadat')) {
    return (
      <Sdeleni nadpis="Záznam zakládá někdo jiný">
        Nový záznam může založit ten, kdo má právo „Jiné platby: vytvořit záznam a nahrát doklad“.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()
  const pobockyRes = await supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null).order('name')
  if (pobockyRes.error) throw new DotazSelhal('pobočky firmy', pobockyRes.error)

  const vsechnyPobocky = (pobockyRes.data ?? []) as { id: string; name: string }[]
  const kandidati = pobockaRozsahu ? vsechnyPobocky.filter((b) => b.id === pobockaRozsahu) : vsechnyPobocky
  const smiZadat = await pobockySPravem(tenantId, kandidati.map((b) => b.id), ['jine_platby.zadat'])
  const povolene = kandidati.filter((b) => smiZadat.has(b.id))
  const pokladnyPobocek = await Promise.all(
    povolene.map(async (b) => {
      const { data, error } = await supabase.rpc('jine_platby_pokladny', { p_tenant: tenantId, p_branch: b.id })
      if (error) throw new DotazSelhal('pokladny provozovny', error)
      return (data ?? []) as { id: string; nazev: string | null; poskytovatel: string }[]
    }),
  )

  // Do prohlížeče jen id a název pokladny.
  const pobocky: PobockaVolba[] = povolene.map((b, i) => ({
    id: b.id,
    nazev: b.name,
    pokladny: pokladnyPobocek[i].map((p) => ({ id: p.id, nazev: (p.nazev ?? '').trim() || p.poskytovatel })),
  }))

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance · Tržby · Jiné platby"
        popis="Nejdřív provozovna a pokladna. Fotku dokladu nahrajete v dalším kroku, na kartě záznamu."
        vpravo={
          <Link href={zpet} className="ft-tl ft-tl-vedlejsi">
            Zpět na přehled
          </Link>
        }
      >
        Nový záznam
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '640px' }}>
        {pobocky.length === 0 ? (
          <div className="ds-plocha">
            <EmptyState ikona={<Ikona klic="pobocka" velikost={32} />} nadpis="Žádná provozovna k výběru">
              {pobockaRozsahu
                ? 'Tahle provozovna je vypnutá, nebo na ní nemáte právo zakládat Jiné platby.'
                : 'Na žádné aktivní provozovně nemáte právo zakládat Jiné platby.'}
            </EmptyState>
          </div>
        ) : (
          <FormularNovehoZaznamu
            rozsah={rozsah}
            pobocky={pobocky}
            pevnaPobocka={pobockaRozsahu}
            klientId={randomUUID()}
            vidiPokladny
          />
        )}
      </div>
    </Navigace>
  )
}
