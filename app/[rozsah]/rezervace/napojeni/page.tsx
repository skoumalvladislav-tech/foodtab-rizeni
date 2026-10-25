import { redirect } from 'next/navigation'

import Badge from '@/components/ui/Badge'
import Sdeleni from '@/app/sdeleni'
import { canSee } from '@/lib/authz'
import { datumACasSRokemVPasmu } from '@/lib/cas'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { SYSTEMY, najitSystem, popisStavuPripojeni } from '@/lib/rezervace-poskytovatele'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

import { PanelHlava } from '../../dnes/prvky'
import Nadpis from '../../nadpis'
import { odpojitNapojeni, pripravitNapojeni } from '../akce'
import { zkusPristupRezervacim } from '../pristup'
import { HlaskaAkce, ZalozkyRezervaci } from '../prvky'
import ImportFormular from './import-formular'

export const dynamic = 'force-dynamic'

const TONY = { dobre: 'success', info: 'accent', pozor: 'warning', bad: 'danger', neutral: 'neutral' } as const

type Napojeni = { id: string; branch_id: string; poskytovatel: string; stav: string; nazev: string; posledni_test_kdy: string | null }

/**
 * Rezervace → Napojení a import.
 *
 * Tři věci na jednom místě:
 *   1. stav napojení na rezervační systém u každé pobočky — vidí ho
 *      každý, kdo vidí rezervace (přes `rezervace_napojeni`, registr sám
 *      čte jen `finance.read`);
 *   2. příprava a odpojení napojení — jen `integrace.manage`, stejné
 *      právo jako u pokladny a banky;
 *   3. načtení rezervací ze souboru — `rezervace.manage` na pobočce.
 *
 * Napojení vzniká jako „čeká na připojení“. Adaptér žádného systému
 * zatím není (bez dokumentace a přístupu se nevymýšlí) a „připojeno“
 * databáze dovolí jen po ověřeném přístupu.
 */
export default async function RezervaceNapojeni({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ stav?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { stav, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>
  }
  const pristup = await zkusPristupRezervacim(tenantId, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Rezervace vidí ten, kdo má právo „Vidět rezervace a kalendář akcí“.</Sdeleni>
  }

  const { pobocky, ctx } = pristup
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('rezervace_napojeni', { p_tenant: tenantId })
  if (error) throw new DotazSelhal('napojení rezervací', error)
  const vRozsahu = new Set(pobocky.map((p) => p.id))
  const napojeni = ((data ?? []) as Napojeni[]).filter((n) => vRozsahu.has(n.branch_id))
  const nazevPobocky = new Map(pobocky.map((p) => [p.id, p.nazev]))
  const zona = pobocky[0].zona

  const smiSpravovat = canSee(ctx, 'integrace.manage')
  const kImportu = pobocky.filter((p) => p.zapis)
  const sApi = SYSTEMY.filter((s) => s.klic !== 'jiny')

  return (
    <>
      <Nadpis oci="Provoz · Rezervace a akce" popis="Propojení s rezervačním systémem a načtení rezervací ze souboru.">
        Napojení a import
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="napojeni" />
        <HlaskaAkce stav={stav} chyba={chyba} />

        <section className="ds-plocha">
          <PanelHlava ikona="kolo" nadpis="Napojení na rezervační systém" />
          <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--muted)', lineHeight: 1.5 }}>
            Foodtab umí rezervace z rezervačního systému převzít a přidat k nim poznámky a dokumenty. Čas, počet osob, stav
            a kontakt zůstávají v rezervačním systému — tam se mění. Dokud se systém neověří, je napojení „čeká na připojení“
            a rezervace jdou zapsat ručně nebo načíst ze souboru.
          </p>
          {napojeni.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px' }}>Zatím žádné napojení.</p>
          ) : (
            <ul className="ds-rez-prilohy">
              {napojeni.map((n) => {
                const popis = popisStavuPripojeni(n.stav)
                return (
                  <li key={n.id} className="ds-rez-priloha" style={{ flexWrap: 'wrap' }}>
                    <strong>{najitSystem(n.poskytovatel)?.nazev ?? n.poskytovatel}</strong>
                    <span style={{ color: 'var(--muted)' }}>{nazevPobocky.get(n.branch_id)}</span>
                    <Badge tone={TONY[popis.ton]}>{popis.text}</Badge>
                    {n.posledni_test_kdy ? <small>ověřeno {datumACasSRokemVPasmu(n.posledni_test_kdy, zona)}</small> : null}
                    {smiSpravovat ? (
                      <form action={odpojitNapojeni}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="id" value={n.id} />
                        <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                          Odpojit
                        </button>
                      </form>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}

          {smiSpravovat ? (
            <form action={pripravitNapojeni} className="ds-rez-formular" style={{ marginTop: '16px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <div className="ds-rez-mrizka">
                <label className="ds-field">
                  <span className="ds-field-label">Pobočka</span>
                  <select className="ds-input" name="pobocka" defaultValue={pobocky[0].id}>
                    {pobocky.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nazev}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ds-field">
                  <span className="ds-field-label">Rezervační systém</span>
                  <select className="ds-input" name="system" defaultValue={sApi[0].klic}>
                    {sApi.map((s) => (
                      <option key={s.klic} value={s.klic}>
                        {s.nazev}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="ds-rez-tlacitka">
                <button type="submit" className="ft-tl ft-tl-vedlejsi">
                  Připravit napojení
                </button>
              </div>
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
                Vznikne záznam „čeká na připojení“. Přístupové údaje se zadají, až bude pro ten systém hotové ověření.
              </p>
            </form>
          ) : (
            <p style={{ margin: '12px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
              Napojení připravuje ten, kdo má právo „Správa napojení na externí systémy“.
            </p>
          )}
        </section>

        {kImportu.length > 0 ? (
          <section className="ds-plocha">
            <PanelHlava ikona="faktura" nadpis="Načíst rezervace ze souboru" />
            <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--muted)', lineHeight: 1.5 }}>
              Export z rezervačního systému ve formátu CSV. Appka pozná sloupce Datum, Čas (Od, Do), Jméno, Počet osob,
              Telefon, E-mail, Poznámka, Stav, Stůl a Číslo rezervace (česky i anglicky). Opakované načtení stejného souboru
              nic nezdvojí; poznámky a dokumenty, které jste k rezervacím přidali ve Foodtabu, zůstanou.
            </p>
            <ImportFormular rozsah={rozsah} pobocky={kImportu.map((p) => ({ id: p.id, nazev: p.nazev }))} systemy={SYSTEMY} />
          </section>
        ) : null}

        <section className="ds-plocha">
          <PanelHlava ikona="lupa" nadpis="Které systémy jde napojit" />
          <div className="ds-rez-systemy">
            {SYSTEMY.map((s) => (
              <article key={s.klic} className="ds-rez-system">
                <h3>{s.nazev}</h3>
                <div className="ds-rez-system-stitky">
                  <Badge tone={s.api === 'verejne' ? 'success' : s.api === 'partnerske' ? 'warning' : 'neutral'}>
                    {s.api === 'verejne' ? 'veřejné API' : s.api === 'partnerske' ? 'API jen pro partnery' : 'bez API'}
                  </Badge>
                  {s.webhooky ? <Badge tone="accent">hlásí změny</Badge> : null}
                  {s.exportSouboru ? <Badge>export do souboru</Badge> : null}
                </div>
                <p>{s.popis}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
