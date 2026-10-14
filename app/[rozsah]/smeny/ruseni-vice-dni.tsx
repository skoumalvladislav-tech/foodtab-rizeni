'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { denKratce } from '@/lib/rozpis-desktop'
import {
  barvaRuseni,
  otiskSmeny,
  souhrnNahledu,
  souhrnRuseni,
  textTlacitkaRuseni,
  type DenNahledu,
  type StavRuseni,
  type VysledekRuseni,
} from '@/lib/ruseni-smen'
import { pocet } from '@/lib/sklonovani'
import { prepnoutDen, TYDNU_KROK, TYDNU_MAX, TYDNU_VYCHOZI } from '@/lib/vyber-dnu'
import { nahledRuseni, zrusitViceDni } from './ruseni'
import VyberDnu from './vyber-dnu'

/**
 * „Zrušit / smazat i v jiné dny“ — pokračování potvrzení „Zrušit tuhle
 * směnu?“, když si vedoucí zapne víc dnů (Šéfík 14. 10. 2026: „potřebuji
 * u rušení směn označit více dní“).
 *
 * Kreslí ho panel na počítači (formular-smeny.tsx) i detail směny na
 * telefonu (mobil/detail.tsx) — jedna komponenta, `telefon` mění jen
 * třídy tlačítek. Bez zapnuté volby se nic z toho nekreslí a jedna směna
 * se ruší přesně jako dřív (`smazatSmenu`).
 *
 * TŘI KROKY, ŽÁDNÝ NAPŘESKÁČKU
 *
 *   1. Výběr dnů ve stejné mřížce jako u zakládání (vyber-dnu.tsx). Den
 *      téhle směny je vybraný napevno — kvůli ní se dialog otevřel.
 *   2. Náhled ze serveru (`nahledRuseni`): den po dni, co se zruší (vydaná)
 *      a co smaže (nevydaná), i dny, kde není co rušit. Které směny to
 *      jsou, rozhoduje server, ne tahle obrazovka.
 *   3. Potvrzení (`zrusitViceDni`) pošle otisky toho, co člověk viděl;
 *      server všechno spočítá znovu a když se mezitím rozpis změnil,
 *      nezruší nic.
 *
 * Potvrzovací tlačítko se objeví až s náhledem, a o kus níž než tlačítko
 * náhledu — dvojklik na „Ukázat, co se zruší“ tak nemůže trefit potvrzení.
 */
export default function RuseniViceDni({
  rozsah,
  smena,
  telefon = false,
  onZpet,
  onOdeslano,
  onHotovo,
}: {
  rozsah: string
  smena: { id: string; shift_date: string; employee_id: string | null }
  /** Detail na telefonu — dotyková tlačítka `.ds-sm-tl`, jinak `.ft-tl` panelu. */
  telefon?: boolean
  /** Zpátky k potvrzení jedné směny (volba se vypne). */
  onZpet: () => void
  /**
   * Potvrzení odešlo. Rodič si podrží okno: rušená směna po obnovení dat
   * z rozpisu zmizí, a s ní by zmizel i výsledek, který je potřeba ukázat.
   */
  onOdeslano?: () => void
  /** „Hotovo“ u výsledku. */
  onHotovo: () => void
}) {
  const router = useRouter()
  const den = smena.shift_date
  const [vybrane, setVybrane] = useState<string[]>([den])
  const [pocetTydnu, setPocetTydnu] = useState(TYDNU_VYCHOZI)
  /*
    Náhled platí jen pro výběr, ke kterému se načetl (`pro`). Kdo pak
    přidá nebo odebere den, potvrzovací tlačítko zmizí, dokud se náhled
    nenačte znovu — nepotvrzuje se nic, co nebylo vidět.
  */
  const [nahled, setNahled] = useState<{ pro: string; dny: DenNahledu[]; verze: number } | null>(null)
  const [chybaNahledu, setChybaNahledu] = useState<string | null>(null)
  const [nacita, setNacita] = useState(false)
  const [odeslanaVerze, setOdeslanaVerze] = useState<number | null>(null)
  const [stav, akce, ceka] = useActionState<StavRuseni, FormData>(zrusitViceDni, { stav: 'nic' })

  useEffect(() => {
    if (stav.stav === 'hotovo') router.refresh()
  }, [stav, router])

  const platny = nahled && nahled.pro === vybrane.join(',') ? nahled : null
  /*
    Zamítnutí potvrzení (rozpis se od náhledu změnil…) patří k náhledu,
    se kterým se odesílalo. Dokud se nenačte nový, hláška zůstává a znovu
    potvrdit nejde — stejná data by server odmítl zase.
  */
  const zamitnuto = stav.stav === 'chyba' && odeslanaVerze !== null && nahled?.verze === odeslanaVerze
  // Potvrzení je nevratné — na počítači `.ft-tl-nebezpecne` (globals.css: „co nejde vzít zpět“).
  const tl = telefon
    ? { hlavni: 'ds-sm-tl ds-sm-tl-hlavni', nebezpeci: 'ds-sm-tl ds-sm-tl-nebezpeci', vedlejsi: 'ds-sm-tl', rada: 'ds-sm-potvrzeni-akce' }
    : { hlavni: 'ft-tl ft-tl-hlavni', nebezpeci: 'ft-tl ft-tl-nebezpecne', vedlejsi: 'ft-tl ft-tl-vedlejsi', rada: 'ds-sm-rv-tlacitka' }

  async function ukazat() {
    const pro = vybrane
    setNacita(true)
    setChybaNahledu(null)
    try {
      const r = await nahledRuseni(rozsah, smena.id, pro)
      if (r.stav === 'ok') {
        setNahled({ pro: pro.join(','), dny: r.dny, verze: Date.now() })
      } else {
        setNahled(null)
        setChybaNahledu(r.text)
      }
    } catch {
      setNahled(null)
      setChybaNahledu('Náhled se nepodařilo načíst. Zkuste to znovu.')
    } finally {
      setNacita(false)
    }
  }

  if (stav.stav === 'hotovo') {
    return <PrehledVysledku smeny={stav.smeny} dnuBezSmen={stav.dnyBezSmen.length} tlacitko={tl.hlavni} onHotovo={onHotovo} />
  }

  return (
    <div className="ds-sm-rv">
      <label className="ds-sm-rv-volba">
        <input type="checkbox" checked onChange={onZpet} />
        Zrušit / smazat i v jiné dny
      </label>
      <p className="ds-sm-rv-vysvetleni">
        {smena.employee_id
          ? 'V každém dalším vybraném dni se zruší všechny směny téhož člověka na této pobočce.'
          : 'V každém dalším vybraném dni se zruší neobsazené směny na této pobočce se stejnou pozicí a stejným časem.'}{' '}
        Vydané se zruší, nevydané smažou — co přesně, ukáže náhled před potvrzením.
      </p>

      <VyberDnu
        zacatek={den}
        vybrane={vybrane}
        pocetTydnu={pocetTydnu}
        zamcene={[den]}
        popisek="Dny, ve kterých se směny zruší nebo smažou"
        onPrepnout={(d) => setVybrane((v) => (d === den ? v : prepnoutDen(v, d)))}
        onVicTydnu={
          pocetTydnu < TYDNU_MAX ? () => setPocetTydnu((n) => Math.min(TYDNU_MAX, n + TYDNU_KROK)) : undefined
        }
      />
      <p className="ds-sm-rv-vysvetleni">
        {vybrane.length < 2
          ? 'Vyberte v mřížce další dny.'
          : `Vybráno ${pocet(vybrane.length, 'den', 'dny', 'dní')}: ${vybrane.map(denKratce).join(', ')}`}
      </p>

      <button type="button" className={tl.vedlejsi} onClick={ukazat} disabled={nacita || vybrane.length < 2}>
        {nacita ? 'Načítám náhled…' : platny ? 'Načíst náhled znovu' : 'Ukázat, co se zruší'}
      </button>
      {chybaNahledu ? <p className="hlaska-chyba">{chybaNahledu}</p> : null}

      {platny ? (
        <>
          <p className="ds-sm-rv-souhrn">{souhrnNahledu(platny.dny)}.</p>
          <NahledRuseni dny={platny.dny} />
        </>
      ) : null}

      {zamitnuto ? <p className="hlaska-chyba">{stav.text}</p> : null}

      {/*
        Vlastní formulář — nevnořuje se do formuláře jedné směny, stojí
        místo něj. Posílá vybrané dny a OTISKY směn z náhledu; bez
        platného náhledu se nekreslí ani potvrzovací tlačítko.
      */}
      <form
        action={akce}
        onSubmit={() => {
          setOdeslanaVerze(platny?.verze ?? null)
          onOdeslano?.()
        }}
      >
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="smena" value={smena.id} />
        {platny
          ? vybrane.map((d) => <input key={d} type="hidden" name="dny" value={d} />)
          : null}
        {platny
          ? platny.dny
              .flatMap((d) => d.smeny)
              .map((s) => <input key={s.id} type="hidden" name="smeny" value={otiskSmeny(s)} />)
          : null}
        <div className={tl.rada}>
          {platny && !zamitnuto ? (
            <button type="submit" className={tl.nebezpeci} disabled={ceka}>
              {ceka ? 'Provádím…' : textTlacitkaRuseni(platny.dny)}
            </button>
          ) : null}
          <button type="button" className={tl.vedlejsi} onClick={onZpet}>
            Zpět
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * Náhled po dnech — jen kreslí, data dodá `nahledRuseni`. Den bez směny
 * se ukáže výslovně („nic k zrušení“), ať nikdo nehádá, jestli se na něj
 * zapomnělo.
 */
export function NahledRuseni({ dny }: { dny: DenNahledu[] }) {
  const maVydane = dny.some((d) => d.smeny.some((s) => s.akce === 'zrusit'))
  return (
    <>
      <ul className="ds-sm-rv-nahled" aria-label="Co se stane v jednotlivých dnech">
        {dny.map((d) => (
          <li key={d.den} className="ds-sm-rv-den" data-prazdny={d.smeny.length === 0 ? '' : undefined}>
            <span className="ds-sm-rv-datum">{denKratce(d.den)}</span>
            {d.smeny.length === 0 ? (
              <span className="ds-sm-rv-nic">nic k zrušení</span>
            ) : (
              <ul>
                {d.smeny.map((s) => (
                  <li key={s.id} className="ds-sm-rv-smena">
                    <span className="ds-sm-rv-cas">
                      {s.od}–{s.do}
                    </span>
                    <span className="ds-sm-rv-kdo">
                      {[s.kdo, s.pozice].filter(Boolean).join(' · ')}
                      {s.vychozi ? ' (tato směna)' : ''}
                    </span>
                    <span className="ds-sm-rv-akce" data-akce={s.akce}>
                      {s.akce === 'zrusit' ? 'zruší se (vydaná)' : 'smaže se (nevydaná)'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {maVydane ? (
        <p className="ds-sm-rv-vysvetleni">
          Vydané směny zůstanou vidět jako zrušené a lidem zmizí, až rozpis vydáte.
        </p>
      ) : null}
    </>
  )
}

/**
 * Výsledek po zrušení: souhrn počtů a pak každá směna, která neprošla —
 * s hláškou z databáze. Neúspěch musí být vidět, ne jen v počtu.
 */
export function PrehledVysledku({
  smeny,
  dnuBezSmen,
  tlacitko,
  onHotovo,
}: {
  smeny: VysledekRuseni[]
  dnuBezSmen: number
  tlacitko: string
  onHotovo: () => void
}) {
  const chyby = smeny.filter((v) => v.chyba !== null)
  return (
    <div className="ds-sm-rv" role="status">
      <p className="ds-sm-rv-souhrn" style={{ color: barvaRuseni(smeny) }}>
        {souhrnRuseni(smeny, dnuBezSmen)}.
      </p>
      {chyby.length > 0 ? (
        <ul className="ds-sm-rv-chyby">
          {chyby.map((v) => (
            <li key={v.id}>
              <strong>
                {denKratce(v.den)} {v.od}–{v.do}:{' '}
              </strong>
              neprošlo — {v.chyba}
            </li>
          ))}
        </ul>
      ) : null}
      {smeny.some((v) => v.vysledek === 'zrusena') ? (
        <p className="ds-sm-rv-vysvetleni">
          Zrušené směny zůstanou vidět jako zrušené a lidem zmizí, až rozpis vydáte.
        </p>
      ) : null}
      <button type="button" className={tlacitko} onClick={onHotovo}>
        Hotovo
      </button>
    </div>
  )
}
