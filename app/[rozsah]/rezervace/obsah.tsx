import Link from 'next/link'

import Badge from '@/components/ui/Badge'
import { datetimeLocalVPasmu, datumACasSRokemVPasmu } from '@/lib/cas'
import { denDlouze, dnyTydne, hosteText, mrizkaMesice, nazevMesice, nazevTydne, podleDne, souhrnDne, type Pohled } from '@/lib/rezervace-kalendar'
import { obdobiPohledu, souhrnText, souhrnyPobocek } from '@/lib/rezervace-pobocky'
import { najitSystem } from '@/lib/rezervace-poskytovatele'
import { NAZVY_DRUHU, NAZVY_STAVU, STAVY, type StavRezervace } from '@/lib/rezervace-typy'
import { svatekDne, svatkyObdobi, type Svatek, type ZemeSvatku } from '@/lib/svatky'

import { KpiKarta } from '../dnes/prvky'
import Ikona from '../ikona'
import Nadpis from '../nadpis'
import { PruhSvatku, SvatkyObdobi } from '../svatek'
import { zmenitStav } from './akce'
import FormularRezervace from './formular'
import type { PobockaRezervaci } from './pristup'
import {
  HlaskaAkce,
  MesicKalendar,
  NastrojePohledu,
  PanelPoznamek,
  PanelPriloh,
  PobockyKalendare,
  SeznamRezervaci,
  StitekStavu,
  TydenKalendar,
  UdajeRezervace,
  ZalozkyRezervaci,
  ZnackaPobocky,
  casRezervace,
  titulek,
  type Poznamka,
  type Priloha,
  type RezervaceRadek,
} from './prvky'

/**
 * Obsah obrazovek Rezervací — ČISTĚ KRESLICÍ, stejně jako prvky.tsx.
 *
 * Stránky (page.tsx) si ověří přístup, načtou data a pošlou je sem.
 * Rozdělené proto, aby šly obrazovky vykreslit i s ukázkovými daty
 * (snímky pro kontrolu vzhledu) bez přihlášení a bez databáze.
 */

/* ---------- kalendář (týden, měsíc) ----------------------------------- */

export function KalendarObsah({
  rozsah,
  pohled,
  datum,
  dnes,
  pobocky,
  rezervace,
  znacky,
  zemeSvatku,
}: {
  rozsah: string
  pohled: Exclude<Pohled, 'den'>
  datum: string
  dnes: string
  pobocky: PobockaRezervaci[]
  rezervace: RezervaceRadek[]
  /** Klíč `pobočka|den` → počty poznámek a příloh ke dni. */
  znacky: Map<string, { poznamek: number; priloh: number }>
  /** Země firmy pro svátky (lib/svatky-firmy.ts); `null` = svátky té země neznáme. */
  zemeSvatku: ZemeSvatku | null
}) {
  const poDnech = podleDne(rezervace)
  // Souhrn pobočky jen za zobrazené období — u měsíce bez dnů sousedních
  // měsíců, které mřížka ukazuje do celých týdnů (a načítá). Totéž období má i seznam svátků.
  const obdobiKalendare = obdobiPohledu(pohled, datum)
  const souhrny = souhrnyPobocek(
    rezervace,
    pobocky.map((p) => p.id),
    obdobiKalendare,
  )
  const obdobi = pohled === 'tyden' ? `za týden ${nazevTydne(datum)}` : `za ${nazevMesice(datum).toLowerCase()}`
  const znackyDne = (den: string) =>
    pobocky.reduce(
      (s, p) => {
        const z = znacky.get(`${p.id}|${den}`)
        return { poznamek: s.poznamek + (z?.poznamek ?? 0), priloh: s.priloh + (z?.priloh ?? 0) }
      },
      { poznamek: 0, priloh: 0 },
    )
  const smiZapisovat = pobocky.some((p) => p.zapis)
  // Svátek k buňce se stejným datem — den kalendáře je provozní den toho data (lib/svatky.ts).
  const svatek = (den: string): Svatek | null => svatekDne(den, zemeSvatku)

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis={
          pobocky.length > 1
            ? `Rezervace hostů a akce všech poboček (${pobocky.map((p) => p.nazev).join(', ')}).`
            : 'Rezervace hostů a akce — uzavřené společnosti, catering, oslavy.'
        }
      >
        Rezervace a akce
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="kalendar" />
        <NastrojePohledu rozsah={rozsah} pohled={pohled} datum={datum} dnes={dnes} smiZapisovat={smiZapisovat} />
        <PobockyKalendare pobocky={pobocky} souhrny={souhrny} obdobi={obdobi} />
        {pohled === 'tyden' ? (
          <TydenKalendar
            rozsah={rozsah}
            dnes={dnes}
            smiZapisovat={smiZapisovat}
            pobocky={pobocky}
            dny={dnyTydne(datum).map((den) => ({ den, rezervace: poDnech.get(den) ?? [], ...znackyDne(den), svatek: svatek(den) }))}
          />
        ) : (
          <MesicKalendar
            rozsah={rozsah}
            dnes={dnes}
            pobocky={pobocky}
            tydny={mrizkaMesice(datum).map((tyden) =>
              tyden.map((d) => ({
                ...d,
                rezervace: poDnech.get(d.den) ?? [],
                poznamek: znackyDne(d.den).poznamek,
                // Den sousedního měsíce svátek neukazuje — v seznamu pod mřížkou by chyběl a zmátl by.
                svatek: d.vMesici ? svatek(d.den) : null,
              })),
            )}
          />
        )}
        <SvatkyObdobi svatky={svatkyObdobi(obdobiKalendare.od, obdobiKalendare.do, zemeSvatku)} />
      </div>
    </>
  )
}

/* ---------- den ----------------------------------------------------------- */

export type DenPobocky = {
  pobocka: PobockaRezervaci
  rezervace: RezervaceRadek[]
  poznamky: Poznamka[]
  prilohy: Priloha[]
}

export function DenObsah({
  rozsah,
  datum,
  dnes,
  tenantId,
  kDnu,
  svatek,
  stav,
  chyba,
}: {
  rozsah: string
  datum: string
  dnes: string
  tenantId: string
  kDnu: DenPobocky[]
  /** Svátek kalendářního data dne (lib/svatky.ts), nebo `null`. */
  svatek: Svatek | null
  stav?: string
  chyba?: string
}) {
  const s = souhrnDne(kDnu.flatMap((k) => k.rezervace))
  const zpet = `/${rozsah}/rezervace/den/${datum}`
  const vic = kDnu.length > 1

  return (
    <>
      <Nadpis oci="Provoz · Rezervace a akce" popis={datum === dnes ? 'Dnešní provozní den.' : undefined}>
        {denDlouze(datum)}
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="kalendar" />
        <NastrojePohledu rozsah={rozsah} pohled="den" datum={datum} dnes={dnes} smiZapisovat={kDnu.some((k) => k.pobocka.zapis)} />
        <PruhSvatku svatek={svatek} />
        <HlaskaAkce stav={stav} chyba={chyba} />

        <div className="ds-rez-kpi">
          <KpiKarta
            ikona="rezervace"
            ton="info"
            titulek="Rezervace"
            hodnota={String(s.rezervaci)}
            popisy={[s.zrusenych ? `${s.zrusenych} zrušených nebo nedorazili` : 'bez zrušených']}
          />
          <KpiKarta ikona="lide" ton="dobre" titulek="Hosté" hodnota={hosteText(s)} popisy={['rezervace i akce, bez zrušených']} />
          <KpiKarta
            ikona="praporek"
            ton={s.akci ? 'pozor' : 'neutral'}
            titulek="Akce"
            hodnota={String(s.akci)}
            popisy={[s.akci ? 'uzavřené společnosti, catering' : 'žádná akce']}
          />
        </div>

        <div className="ds-dnes">
          <div className="ds-dnes-hlavni">
            {/* Každá pobočka ve svém rámečku a barvě, se souhrnem dne v hlavičce. */}
            {kDnu.map((k) => (
              <section key={k.pobocka.id} className="ds-plocha ds-rez-oddil" data-branch={k.pobocka.barva} data-pobocka={k.pobocka.id}>
                <div className="ds-plocha-hlava ds-rez-oddil-hlava">
                  <Ikona klic="rezervace" />
                  <h2>{vic ? k.pobocka.nazev : 'Rezervace a akce dne'}</h2>
                  <ZnackaPobocky pobocka={k.pobocka} vedleNazvu={vic} />
                  <span className="ds-rez-oddil-souhrn">{souhrnText(souhrnDne(k.rezervace))}</span>
                </div>
                <SeznamRezervaci rozsah={rozsah} rezervace={k.rezervace} />
              </section>
            ))}
          </div>
          <div className="ds-dnes-bok">
            {kDnu.map((k) => (
              <div key={k.pobocka.id} style={{ display: 'grid', gap: '16px' }}>
                {vic ? (
                  <p className="ds-rez-pobocka">
                    <ZnackaPobocky pobocka={k.pobocka} vedleNazvu /> {k.pobocka.nazev}
                  </p>
                ) : null}
                <PanelPoznamek
                  rozsah={rozsah}
                  cil={{ den: datum, pobocka: k.pobocka.id }}
                  zpet={zpet}
                  poznamky={k.poznamky}
                  zona={k.pobocka.zona}
                  smiZapisovat={k.pobocka.zapis}
                  nadpis="Poznámky ke dni"
                />
                <PanelPriloh
                  rozsah={rozsah}
                  cil={{ den: datum, pobocka: k.pobocka.id }}
                  zpet={zpet}
                  prilohy={k.prilohy}
                  zona={k.pobocka.zona}
                  smiZapisovat={k.pobocka.zapis}
                  tenantId={tenantId}
                  branchId={k.pobocka.id}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

/* ---------- detail rezervace / akce ------------------------------------ */

export type DetailRezervace = {
  radek: RezervaceRadek
  menu: string
  zaloha: { haleru: number | null; stav: string }
  poznamkaZdroje: string
  stavZdroje: string
  poskytovatel: string | null
  importovanoKdy: string | null
}

export function DetailObsah({
  rozsah,
  tenantId,
  detail,
  pobocka,
  poznamky,
  prilohy,
  kontakt,
  stav,
  chyba,
}: {
  rozsah: string
  tenantId: string
  detail: DetailRezervace
  pobocka: PobockaRezervaci
  poznamky: Poznamka[]
  prilohy: Priloha[]
  /** `null` = člověk kontakt vidět nesmí. */
  kontakt: { telefon: string; email: string } | null
  stav?: string
  chyba?: string
}) {
  const r = detail.radek
  const smiZapisovat = pobocka.zapis
  const zRezervacnihoSystemu = r.zdroj !== 'rucne'
  const zpet = `/${rozsah}/rezervace/${r.id}`
  const zacatek = datetimeLocalVPasmu(r.zacatek, r.zona)
  const konec = r.konec ? datetimeLocalVPasmu(r.konec, r.zona) : ''
  const system = detail.poskytovatel ? najitSystem(detail.poskytovatel) : null

  return (
    <>
      <Nadpis
        oci={`Provoz · ${NAZVY_DRUHU[r.druh]}`}
        popis={`${denDlouze(r.den)} · ${casRezervace(r, r.zona)} · ${pobocka.nazev}`}
        vpravo={
          <Link href={`/${rozsah}/rezervace/den/${r.den}`} className="ft-tl ft-tl-vedlejsi">
            <Ikona klic="sipkaVlevo" /> Na celý den
          </Link>
        }
      >
        {titulek(r)}
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="kalendar" />
        <HlaskaAkce stav={stav} chyba={chyba} />

        <div className="ds-dnes">
          <div className="ds-dnes-hlavni">
            <section className="ds-plocha">
              <div className="ds-plocha-hlava">
                <Ikona klic={r.druh === 'akce' ? 'praporek' : 'rezervace'} />
                <h2>Údaje</h2>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {r.druh === 'akce' ? <Badge tone="vino">Akce</Badge> : null}
                  <StitekStavu stav={r.stav} />
                </span>
              </div>
              <UdajeRezervace
                r={r}
                nazevPobocky={pobocka.nazev}
                zaloha={detail.zaloha}
                menu={detail.menu}
                poznamkaZdroje={detail.poznamkaZdroje}
                kontakt={kontakt}
              />
              {zRezervacnihoSystemu ? (
                <p className="ds-rez-zdroj" style={{ marginTop: '14px' }}>
                  {r.zdroj === 'csv' ? 'Načteno ze souboru' : 'Převzato z rezervačního systému'}
                  {system ? ` (${system.nazev})` : detail.poskytovatel ? ` (${detail.poskytovatel})` : ''}
                  {detail.importovanoKdy ? `, naposledy ${datumACasSRokemVPasmu(detail.importovanoKdy, r.zona)}` : ''}.
                  {detail.stavZdroje ? ` Stav ve zdroji: „${detail.stavZdroje}“.` : ''} Čas, počet osob, stav, jméno a kontakt se mění
                  tam; poznámky, dokumenty, prostor, menu a záloha patří Foodtabu a příští načtení je nepřepíše.
                </p>
              ) : null}
              {smiZapisovat && !zRezervacnihoSystemu ? (
                <div className="ds-rez-tlacitka" style={{ marginTop: '14px' }} role="group" aria-label="Změnit stav">
                  {(STAVY as readonly StavRezervace[])
                    .filter((s) => s !== r.stav)
                    .map((s) => (
                      <form key={s} action={zmenitStav}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="stav" value={s} />
                        <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                          {s === 'zrusena' ? 'Zrušit' : `Označit: ${NAZVY_STAVU[s].toLowerCase()}`}
                        </button>
                      </form>
                    ))}
                </div>
              ) : null}
            </section>

            {smiZapisovat ? (
              <section className="ds-plocha">
                <details>
                  <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                    <div className="ds-plocha-hlava" style={{ marginBottom: 0 }}>
                      <Ikona klic="tuzka" />
                      <h2>Upravit údaje</h2>
                      <span className="ds-plocha-odkaz ds-rez-otevrit">Otevřít formulář →</span>
                    </div>
                  </summary>
                  <FormularRezervace
                    rozsah={rozsah}
                    id={r.id}
                    pobocky={[{ id: pobocka.id, nazev: pobocka.nazev }]}
                    pobocka={pobocka.id}
                    jenFoodtab={zRezervacnihoSystemu}
                    klic=""
                    hodnoty={{
                      druh: r.druh,
                      stav: r.stav,
                      jmeno_hosta: r.jmeno_hosta,
                      nazev: r.nazev,
                      typ_akce: r.typ_akce,
                      datum: zacatek.slice(0, 10),
                      od: zacatek.slice(11, 16),
                      do: konec.slice(11, 16),
                      pocet_osob: r.pocet_osob === null ? '' : String(r.pocet_osob),
                      prostor: r.prostor,
                      menu: detail.menu,
                      zaloha: detail.zaloha.haleru === null ? '' : String(detail.zaloha.haleru / 100).replace('.', ','),
                      zaloha_hosta_stav: detail.zaloha.stav,
                      telefon: kontakt?.telefon ?? '',
                      email: kontakt?.email ?? '',
                    }}
                  />
                </details>
              </section>
            ) : null}
          </div>
          <div className="ds-dnes-bok">
            <PanelPoznamek rozsah={rozsah} cil={{ rezervace: r.id }} zpet={zpet} poznamky={poznamky} zona={r.zona} smiZapisovat={smiZapisovat} />
            <PanelPriloh
              rozsah={rozsah}
              cil={{ rezervace: r.id }}
              zpet={zpet}
              prilohy={prilohy}
              zona={r.zona}
              smiZapisovat={smiZapisovat}
              tenantId={tenantId}
              branchId={r.branch_id}
            />
          </div>
        </div>
      </div>
    </>
  )
}
