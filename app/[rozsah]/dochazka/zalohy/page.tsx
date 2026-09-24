import { redirect } from 'next/navigation'

import { getContext, hasAccess } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { jmenoDoNabidky, lideProZalohy } from '@/lib/lide-pobocky'
import { koruny, prvniDenMesice } from '@/lib/mzdy'
import { provozniDen } from '@/lib/provozni-den'
import { pocet, veta } from '@/lib/sklonovani'
import { nabidkaKVyplaceni } from '@/lib/zalohy-nabidka'
import {
  funkceNeexistuje,
  sloupecNeexistuje,
  tabulkaNeexistuje,
} from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Card from '@/components/ui/Card'
import Nadpis from '../../nadpis'
import DochazkaZalozky from '../zalozky'
import zalozkyDochazky from '../zalozky-prava'
import { stornovatZalohu, ulozitNastaveniZaloh } from './akce'
import FormularZalohy from './formular'
import Pozastaveni from './pozastaveni'
import Storno from './storno'

export const dynamic = 'force-dynamic'

/**
 * Zálohy
 *
 * Zadání docs/kiosek-pin-zalohy-zadani.md, oddíl 6.
 *
 * Obrazovka se otevírá na `advances.manage` NEBO `payroll.read`:
 * vydávat peníze a dělat mzdy jsou dvě různé práce a obojí sem
 * potřebuje vidět. Vyplácet ale smí jen to první — kdo sem přijde
 * s payroll.read, uvidí seznam bez formuláře.
 *
 * Od 24. 9. 2026 je to záložka Docházky (/dochazka/zalohy), ne vlastní
 * položka nabídky — majitel chtěl zálohy tam, odkud se počítají.
 * Obsah i práva se přestěhováním nezměnily; jen hlavička je teď
 * společná „Docházka“ a pod ní lišta záložek.
 */

type Zaloha = {
  id: string
  employee_id: string
  jmeno: string
  branch_id: string
  castka_haleru: number
  business_date: string
  stav: string
  poznamka: string
  storno_duvod: string | null
  vyplaceno_kdy: string
  potvrzeno_kdy: string | null
}

export default async function Zalohy({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; ulozeno?: string }>
}) {
  const { rozsah } = await params
  const { chyba, ulozeno } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  /*
    Dvě různá práva, jedna obrazovka. `zkusPristup` umí jen jedno, tak
    se ptáme zvlášť a rozhodujeme tady — a databáze se ptá znovu
    u každého řádku (zalohy_pobocky), takže tohle je pohodlí, ne zámek.
  */
  const pristup = await zkusPristup(tenantId, 'advances.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')

  const smiVyplacet = pristup.stav === 'ok'
  const smiCist =
    smiVyplacet || (await hasAccess(tenantId, 'payroll.read', null))

  if (!smiCist) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Zálohy vidí ten, kdo je vyplácí (<code>advances.manage</code>),
        nebo kdo dělá mzdy (<code>payroll.read</code>).
      </Sdeleni>
    )
  }

  const smiNastavovat = await hasAccess(tenantId, 'settings.manage', null)
  const supabase = await getServerSupabase()

  /*
    Lišta záložek. Rozsah z adresy se tu musí zjistit zvlášť: kdo sem
    přišel jen s payroll.read, tomu `zkusPristup` rozsah nevrátil
    (odmítl advances.manage). Adresu už ověřil layout; kdyby přesto
    nesedla, záložky se nekreslí.
  */
  const ctx = await getContext(tenantId)
  const rozsahAdresy = ctx ? bezpecnyRozsah(ctx, rozsah) : null
  const zalozky = rozsahAdresy ? (
    <DochazkaZalozky
      rozsah={rozsah}
      aktivni="zalohy"
      viditelne={await zalozkyDochazky(tenantId, rozsahAdresy.branchId)}
    />
  ) : null

  const mesic = prvniDenMesice(new Date())
  const konec = new Date()
  konec.setMonth(konec.getMonth() + 1)
  konec.setDate(0)
  const doDne = `${konec.getFullYear()}-${String(konec.getMonth() + 1).padStart(2, '0')}-${String(konec.getDate()).padStart(2, '0')}`

  const { data: zalohyData, error: chybaZaloh } = await supabase.rpc(
    'zalohy_pobocky',
    { p_tenant: tenantId, p_od: mesic, p_do: doDne, p_branch: null },
  )

  // Nenasazená migrace obrazovku neshodí, jen řekne, na co se čeká.
  if (funkceNeexistuje(chybaZaloh)) {
    return (
      <>
        <HlavickaZaloh />
        <div style={{ padding: '16px' }}>
          {zalozky}
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong>{' '}
            Zálohy přibudou migrací <code>20260901220000_zalohy</code>.
          </p>
        </div>
      </>
    )
  }
  if (chybaZaloh) throw chybaZaloh

  const zalohy = (zalohyData ?? []) as Zaloha[]

  /*
    Lidé, kterým jde vyplácet.

    Lidé pobočky PLUS každý, kdo tu má směnu v okně („zaskakuje“), PLUS
    lidé bez domovské pobočky (ne majitel) — kdo tu dnes stojí směnu,
    tomu může být potřeba vyplatit zálohu.

    Od 24. 9. 2026 z vlastního průzoru `lide_pro_zalohy` (lib/lide-
    pobocky.ts): dřív se bral průzor pro ruční zápis docházky, který
    vrací lidi jen tomu, kdo má `attendance.manage`, a kdo měl jen právo
    vyplácet zálohy, viděl prázdnou nabídku. Pravidlo „kdo sem patří"
    hlídá stejně i `vyplatit_zalohu`.

    Na firemní úrovni se nevyplácí: záloha se vydává na pobočce, protože
    ji tam někdo fyzicky podá z ruky do ruky.
  */
  const pobockaVydeje =
    pristup.stav === 'ok' ? pristup.scope.branchId : null
  const denVydeje = pobockaVydeje ? await provozniDen(pobockaVydeje) : null

  const lide =
    smiVyplacet && pobockaVydeje && denVydeje
      ? await lideProZalohy(tenantId, pobockaVydeje, denVydeje)
      : []

  const { data: nastaveniData, error: chybaNastaveni } = await supabase
    .from('tenant_settings')
    .select('zalohy_zobrazeni, zaloha_max_haleru, zalohy_pozastaveny')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  /*
    Nenasazená migrace neshodí obrazovku — a to platí i pro SLOUPEC,
    ne jen pro tabulku. Pozastavení přidává `zalohy_pozastaveny` migrací
    20260902040000; než projde, tabulka existuje a sloupec ne, takže
    `tabulkaNeexistuje` na to nic neřekne a stránka spadla na 500.
    Našlo se to kliknutím, ne úvahou.
  */
  if (
    chybaNastaveni &&
    !tabulkaNeexistuje(chybaNastaveni) &&
    !sloupecNeexistuje(chybaNastaveni)
  ) {
    throw chybaNastaveni
  }

  const zobrazeni = nastaveniData?.zalohy_zobrazeni ?? 'odecitat'
  const mez = nastaveniData?.zaloha_max_haleru ?? null
  const firmaPozastavena = nastaveniData?.zalohy_pozastaveny === true

  /*
    Pozastavení přepíná JEN payroll.manage — ne ten, kdo zálohy
    u okénka vyplácí (docs/pozastaveni-zaloh-zadani.md, oddíl 3).
    Kdo vykonává, nerozhoduje.
  */
  const smiPozastavovat = await hasAccess(tenantId, 'payroll.manage', null)

  /*
    Stav pozastavení potřebuje i ten, kdo jen VYPLÁCÍ — pozastavený
    člověk nesmí zůstat v nabídce „Komu“. Přepnout ho nesmí, ale
    vidět ho musí, jinak by ho nabídl a odmítnutí by se dozvěděl až
    od databáze, před tím člověkem u okénka.

    Průzor stav_pozastaveni proto pouští dovnitř advances.manage
    i payroll.read, ne jen payroll.manage.
  */
  const { data: stavyData } =
    smiPozastavovat || smiVyplacet
      ? await supabase.rpc('stav_pozastaveni', { p_tenant: tenantId })
      : { data: [] }
  const stavy = (stavyData ?? []) as {
    employee_id: string
    jmeno: string
    pozastaveno: boolean
  }[]

  /*
    Nabídka „Komu“ bez pozastavených.

    Platí přísnější ze dvou úrovní (docs/pozastaveni-zaloh-zadani.md,
    oddíl 2): při vypnutí za firmu nezbude nikdo.

    Tenhle filtr je POHODLÍ, ne obrana. Odmítnutí padá v databázi
    a padne i tomu, kdo si volání poskládá sám — obrazovka jen
    nenabízí něco, co stejně neprojde.
  */
  const { nabidka: lideKVyplaceni, skrytych } = nabidkaKVyplaceni({
    lide,
    pozastaveni: stavy,
    firmaPozastavena,
  })

  const platne = zalohy.filter((z) => z.stav !== 'stornovana')
  const soucet = platne.reduce((s, z) => s + z.castka_haleru, 0)
  const nepotvrzenych = platne.filter((z) => z.stav === 'nepotvrzena').length

  return (
    <>
      <HlavickaZaloh />

      <div style={{ padding: '16px', paddingBottom: '32px' }}>
        {zalozky}
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}
        {ulozeno === 'storno' ? (
          <p style={hlaskaDobre}>
            Záloha stornovaná. Zůstává v seznamu i s důvodem — smazaný
            pohyb peněz je díra v evidenci.
          </p>
        ) : null}
        {ulozeno === 'pozastaveno' ? (
          <p style={hlaskaDobre}>
            Zálohy pozastavené. Nové výplaty neprojdou; dřív vyplacené
            zůstávají beze změny a storno jde dál.
          </p>
        ) : null}
        {ulozeno === 'povoleno' ? (
          <p style={hlaskaDobre}>Zálohy zase povolené.</p>
        ) : null}
        {ulozeno === 'nastaveni' ? (
          <p style={hlaskaDobre}>
            Nastavení uloženo. Změnilo se jen to, co zaměstnanci vidí —
            uložené zálohy zůstaly, jak byly.
          </p>
        ) : null}

        {/*
          Tabulka (hlavní, širší sloupec) + výplatní formulář nebo
          vysvětlení, proč se vyplácet nedá (užší postranní panel) —
          stejný `.ds-dvasloupec` jako na Dnes (design systém,
          16.9.2026). Pod 900px se podsune pod sebe, formulář první —
          u okénka se přišlo hlavně vyplatit, ne číst tabulku.
        */}
        <div className="ds-dvasloupec" style={{ marginTop: '4px' }}>
          <div>
            <h2 style={{ ...nadpisSekce, marginTop: 0 }}>Tenhle měsíc</h2>
            <p style={popisSekce}>
              {platne.length === 0
                ? 'Zatím žádná záloha.'
                : `${pocet(platne.length, 'záloha', 'zálohy', 'záloh')} v součtu ${koruny(soucet)}` +
                  (nepotvrzenych > 0
                    ? ` · ${nepotvrzenych} zatím bez potvrzení PINem`
                    : '')}
            </p>

            {zalohy.length > 0 ? (
              <div style={{ overflowX: 'auto', marginTop: '12px' }}>
                <table style={tabulka}>
                  <thead>
                    <tr style={headRow}>
                      <th style={th}>Den</th>
                      <th style={th}>Komu</th>
                      <th style={th}>Částka</th>
                      <th style={th}>Stav</th>
                      <th style={th}>Poznámka</th>
                      {smiVyplacet ? <th style={th}>Akce</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {zalohy.map((z) => (
                      <tr
                        key={z.id}
                        style={{ ...tr, opacity: z.stav === 'stornovana' ? 0.55 : 1 }}
                      >
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{den(z.business_date)}</td>
                        <td style={td}>{z.jmeno}</td>
                        <td
                          style={{
                            ...td,
                            whiteSpace: 'nowrap',
                            fontVariantNumeric: 'tabular-nums',
                            textDecoration:
                              z.stav === 'stornovana' ? 'line-through' : undefined,
                          }}
                        >
                          {koruny(z.castka_haleru)}
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <StavStitek stav={z.stav} />
                        </td>
                        <td style={{ ...td, fontSize: '13px', color: 'var(--muted)' }}>
                          {z.stav === 'stornovana'
                            ? `Storno: ${z.storno_duvod ?? ''}`
                            : z.poznamka}
                        </td>
                        {smiVyplacet ? (
                          <td style={td}>
                            {z.stav !== 'stornovana' ? (
                              <Storno akce={stornovatZalohu} id={z.id} rozsah={rozsah} />
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          <div>
            {smiVyplacet && !pobockaVydeje ? (
              <p style={ramecek}>
                <strong>Zálohu vyplatíte na pobočce.</strong> Hotovost někdo
                podá z ruky do ruky, takže se záloha váže na místo —
                přepněte se na pobočku a formulář se objeví. Tabulka
                vlevo ukazuje zálohy všech poboček, na které vidíte.
              </p>
            ) : null}

            {smiVyplacet && pobockaVydeje && firmaPozastavena ? (
              <p style={ramecek}>
                <strong>Zálohy jsou pozastavené za celou firmu.</strong> Nová
                výplata neprojde nikomu, ani tomu, kdo pozastavené sám nemá.
                Povolit je zpátky může jen ten, kdo spravuje mzdy. Dřív
                vyplacené zálohy zůstávají beze změny a storno jde dál.
              </p>
            ) : null}

            {smiVyplacet && pobockaVydeje && !firmaPozastavena ? (
              <>
                <FormularZalohy
                  rozsah={rozsah}
                  lide={lideKVyplaceni.map((l) => ({ id: l.id, jmeno: jmenoDoNabidky(l) }))}
                />
                {/*
                  Bez téhle věty by člověk u okénka hledal někoho, kdo
                  z nabídky beze slova zmizel, a myslel by si, že je
                  rozbitá aplikace.
                */}
                {skrytych > 0 ? (
                  <p style={{ ...popisSekce, margin: '8px 0 0' }}>
                    {veta(
                      skrytych,
                      'zaměstnanec není v nabídce, protože má pozastavené zálohy.',
                      'zaměstnanci nejsou v nabídce, protože mají pozastavené zálohy.',
                      'zaměstnanců není v nabídce, protože mají pozastavené zálohy.',
                    )}
                  </p>
                ) : null}
              </>
            ) : null}

            {!smiVyplacet ? (
              <p style={popisSekce}>
                Zálohy vidíte, protože děláte mzdy. Vyplácet je smí ten, kdo
                má právo <code>advances.manage</code>.
              </p>
            ) : null}
          </div>
        </div>

        {smiPozastavovat ? (
          <Pozastaveni
            rozsah={rozsah}
            firmaPozastavena={firmaPozastavena}
            lide={stavy}
          />
        ) : null}

        {smiNastavovat ? (
          <Card as="section" padding="18px" style={{ boxShadow: 'var(--shadow)', marginTop: '28px', maxWidth: '640px' }}>
            <h2 style={nadpis}>Co uvidí zaměstnanci</h2>
            <p style={popisSekce}>
              Volba mění <strong>jen zobrazení</strong>, nikdy uložené
              zálohy. Dá se přepnout kdykoli, projeví se hned i zpětně
              a nic nepřepočítává. Změna jde do auditu.
            </p>

            <form action={ulozitNastaveniZaloh} style={{ display: 'grid', gap: '14px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />

              <div style={{ display: 'grid', gap: '8px' }}>
                {[
                  ['odecitat', 'Odečítat', 'Všechny čtyři řádky včetně „zbývá k výplatě“.'],
                  ['jen_ukazat', 'Jen ukázat', 'Odpracováno, hrubá mzda a zálohy — bez odečtu.'],
                  ['neukazovat', 'Neukazovat', 'Odpracováno a hrubá mzda; zálohy vidí jen vedení.'],
                ].map(([klic, nazev, popisek]) => (
                  <label key={klic} style={volba}>
                    <input
                      type="radio"
                      name="zobrazeni"
                      value={klic}
                      defaultChecked={zobrazeni === klic}
                    />
                    <span>
                      <strong>{nazev}</strong>
                      <span style={vysvetlivka}>{popisek}</span>
                    </span>
                  </label>
                ))}
              </div>

              <label style={poleLabel}>
                <span>Horní mez jedné zálohy v Kč (nepovinné)</span>
                <input
                  name="mez"
                  inputMode="decimal"
                  defaultValue={mez !== null ? String(mez / 100) : ''}
                  placeholder="bez meze"
                  style={{ ...pole, maxWidth: '220px' }}
                />
                <span style={vysvetlivka}>
                  Mez jen <strong>varuje</strong>, nikdy neodmítne —
                  o penězích rozhoduje majitel, ne aplikace.
                </span>
              </label>

              <div>
                <button type="submit" className="ft-tl ft-tl-hlavni">
                  Uložit nastavení
                </button>
              </div>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  )
}

/**
 * Hlavička jako na Docházce: jeden h1 „Docházka“, záložky pod ním.
 * Věta pod nadpisem patří záložce — co se tu eviduje a co ne.
 */
function HlavickaZaloh() {
  return (
    <Nadpis
      oci="Provoz"
      popis="Zálohy: záznam o hotovosti, která přešla z ruky do ruky. Aplikace nikomu nic neposílá — účetní dělá mzdy dál ve svém programu."
    >
      Docházka
    </Nadpis>
  )
}

function StavStitek({ stav }: { stav: string }) {
  if (stav === 'potvrzena') {
    return <span style={{ color: 'var(--dobre)', fontSize: '13px' }}>potvrzená</span>
  }
  if (stav === 'stornovana') {
    return <span style={{ color: 'var(--muted)', fontSize: '13px' }}>stornovaná</span>
  }
  return (
    <span style={{ color: 'var(--pozor)', fontSize: '13px' }}>čeká na PIN</span>
  )
}

/** Z „2026-09-01“ udělá „1. 9.“ */
function den(datum: string): string {
  const [, m, d] = datum.split('-')
  return `${Number(d)}. ${Number(m)}.`
}

const nadpis = { margin: '0 0 8px', fontSize: '17px', color: 'var(--ink)' } as const

const nadpisSekce = {
  margin: '24px 0 4px',
  fontSize: '16px',
  color: 'var(--ink)',
} as const

const popisSekce = {
  margin: '0 0 8px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '62ch',
  lineHeight: 1.5,
} as const

const hlaskaDobre = {
  margin: '0 0 16px',
  fontSize: '14px',
  color: 'var(--dobre)',
} as const

const tabulka = {
  width: '100%',
  borderCollapse: 'collapse' as const,
  minWidth: '640px',
} as const

const headRow = { borderBottom: '1px solid var(--line)' } as const

const th = {
  padding: '10px 12px',
  textAlign: 'left' as const,
  fontSize: '11px',
  fontWeight: '600',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const tr = { borderBottom: '1px solid var(--line)' } as const
const td = { padding: '12px' } as const

const volba = {
  display: 'flex',
  gap: '10px',
  alignItems: 'flex-start',
  fontSize: '14px',
  color: 'var(--ink)',
  minHeight: '32px',
  cursor: 'pointer',
} as const

const vysvetlivka = {
  display: 'block',
  fontSize: '12.5px',
  color: 'var(--muted)',
  marginTop: '2px',
  textTransform: 'none' as const,
  letterSpacing: 'normal',
} as const

const poleLabel = {
  display: 'grid' as const,
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const pole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const

const ramecek = {
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '14px',
} as const
