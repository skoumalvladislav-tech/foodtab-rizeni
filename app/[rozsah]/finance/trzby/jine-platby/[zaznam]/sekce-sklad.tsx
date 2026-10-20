import Link from 'next/link'

import { datumACasSRokemVPasmu } from '@/lib/cas'
import { mnozstviNaText } from '@/lib/jine-platby-castky'
import { REZERVA_PO_PLATNOSTI_MS } from '@/lib/jine-platby-pos-operace'
import { popisStavuSkladu, prohlaseniProtiPokladne, type AkceJinePlatby } from '@/lib/jine-platby-stav'
import { PLATNOST_KONTROLY_SKLADU_MIN, type ZaznamJinePlatby } from '@/lib/jine-platby-typy'

import { PanelHlava } from '../../../../dnes/prvky'
import Ikona from '../../../../ikona'
import { korekceVydeje, odeslatSklad, prohlasitSklad, propojitVydej, rucneDolozit, zrusitSchvaleni } from '../akce'
import { obnovitVydej, provestVydej, rozhodnoutVydej, vydejZnovu, zkontrolovatSklad } from '../akce-pos'
import ZnackaStavu from '../znacka-stavu'
import FormularAkce from './formular-akce'
import { HLASKA_BEZ_DOHLEDANI, POPIS_VYSLEDKU_SKLADU, textPlanovaneOperace } from './logika'
import { MRIZKA_POLI, Oddil, PoleDuvodu, Udaj, Udaje, VSTUP, VysledekKontroly, Vysvetleni } from './prvky'

export type PolozkaVydeje = { poradi: number | null; posProduktId: string; nazev: string; mnozstvi: string }
export type BlokaceVydeje = { poradi: number | null; nazev: string | null; duvod: string }
/**
 * Náhled výdeje z `jine_platby_sestavit_vydej`. `blokace` s `poradi` =
 * nevyřešená POLOŽKA nebo produkt, který v katalogu pokladny není (schválit
 * nejde; ruční doložení blokuje jen nevyřešená položka — `nevyresenePolozky`),
 * bez `poradi` = věc celého výdeje (pokladna neobsluhuje pobočku…).
 * `varovani` (pokrm i kusové zboží) chtějí při schválení výslovné potvrzení.
 */
export type NahledVydeje = { polozky: PolozkaVydeje[]; blokace: BlokaceVydeje[]; polozek: number; varovani: string[] }
export type NavrhVydeje = {
  id: string
  stav: string
  otisk: string
  polozky: PolozkaVydeje[]
  odeslal: string | null
  odeslano: string
  schvalil: string | null
  schvaleno: string | null
  zamitl: string | null
  zamitnuto: string | null
  duvodZamitnuti: string | null
}
export type OperaceVydeje = {
  stav: string
  pokusu: number
  platnostDo: string | null
  externiId: string | null
  externiDoklad: string | null
  chyba: string | null
  duvod: string | null
  zahajeno: string
  dokonceno: string | null
}
/** Řádek dokladu → produkt pokladny (pro „položky, množství, mapování“). */
export type PrevodPolozky = { poradi: number; nazev: string; mnozstvi: string | null; jednotka: string | null; posProduktId: string | null; posMnozstvi: string | null; mapovani: string }

/** Stavy skladu se schváleným, ještě neuzavřeným výdejem — tam se ukazuje, co doložení brání. */
const SKLAD_SCHVALENY_NEUZAVRENY: readonly string[] = ['schvaleno', 'nepodporovano', 'chyba', 'nejasny_vysledek', 'zpracovava_se']
/** Operace na cestě: výsledek nejasný, jen se dohledává. */
const OPERACE_NEJASNA: readonly string[] = ['odesila_se', 'nejasny_vysledek']

const POPIS_OPERACE: Record<string, string> = {
  pripraveno: 'Připraveno k provedení',
  odesila_se: 'Odesílá se do pokladny — čeká se na ověření',
  uspech: 'Provedeno a ověřeno v pokladně',
  nejasny_vysledek: 'Nejasný výsledek — jen se dohledává, neopakuje se',
  chyba: 'Pokladna výdej prokazatelně neprovedla',
  nepodporovano: 'Pokladna zápis přes API neumí — ruční zpracování',
  rucne_dolozeno: 'Ručně doloženo',
  zruseno: 'Zrušeno',
}

/**
 * Sekce (c) Sklad: náhled výdeje (sestavuje ho DATABÁZE z položek),
 * odeslání ke schválení, panel „Potvrdit výdej do POS“ pro schvalovatele
 * a stav operace v pokladně. Odeslání ke schválení ani nahrání fotky sklad
 * nemění; „Odečteno v POS“ je jen po ověření v pokladně, ruční doložení
 * se tak nikdy nejmenuje.
 *
 * Schválení ukazuje možné duplicity (záznamy téže pobočky ± 7 dní) a vždy
 * nabízí nepovinné „Proč to není duplicita“ (`duplicita_duvod` → p_duvod
 * při schválení). Zamítnutí má VLASTNÍ pole `duvod` (důvod zamítnutí) —
 * dvě pole, ať se nepletou.
 *
 * „Ručně doloženo“ nese otisk živého schváleného návrhu (skryté pole);
 * „Zrušit schválení“ je jen pro případ, že v pokladně nic odepsáno nebylo.
 * U požadavku s nejasným výsledkem obojí nabídne `dostupneAkce` až po
 * vypršení jeho platnosti (+ 2 min) — panel pak řekne, že se to musí
 * nejdřív ověřit v pokladně (C5); do té doby se jen dohledává.
 *
 * U schváleného, ještě neuzavřeného výdeje panel ukáže nevyřešené POLOŽKY
 * (`nevyresenePolozky` — řádek ke kontrole, nezařazený, skladový bez
 * ověřeného přiřazení nebo množství); dokud nějaká je, „Ručně doloženo“ se
 * nenabízí (databáze by doložení odmítla). Blokace celého výdeje a katalog
 * změněný po schválení jen upozorní — doložení nebrání (R4).
 *
 * Varování náhledu (pokrm i kusové zboží) ukáže panel schválení i panel
 * ručního odpisu. Schválení s varováním chce POVINNÉ zaškrtnutí „Zboží není
 * surovina toho pokrmu“ (`bez_surovin` → `p_bez_surovin`, C6).
 *
 * Ruční prohlášení „neodečetla“ proti poslednímu výsledku pokladny „už
 * odečetla“ (`prohlaseniProtiPokladne`, bez ohledu na verzi) jen s právem
 * na opravy a s povinným zaškrtnutím `prepsat_pokladnu`.
 */
export default function SekceSklad({
  zakl,
  z,
  akce,
  smiOpravit,
  maPokladnu,
  pokladna,
  provozovna,
  nahled,
  navrh,
  operace,
  prevody,
  originaly,
  nevyresenePolozky = [],
  duplicity,
  jednotkyProduktu,
  muzeSchvalit,
  vydej,
  tedMs,
  jmena,
  zona,
}: {
  zakl: { zaznam: string; verze: number; rozsah: string }
  z: ZaznamJinePlatby
  akce: ReadonlySet<AkceJinePlatby>
  /** Právo na opravy (`jine_platby.oprava`) na pobočce záznamu — smí přepsat výsledek pokladny ručním prohlášením. */
  smiOpravit: boolean
  maPokladnu: boolean
  pokladna: { nazev: string; nazevPoskytovatele: string; dohledaniUctu: boolean; skladovyVydej: 'api' | 'rucne' | 'nepodporovano' } | null
  provozovna: string
  nahled: NahledVydeje | null
  /** Poslední skladový návrh (i zamítnutý nebo nahrazený). */
  navrh: NavrhVydeje | null
  operace: OperaceVydeje | null
  prevody: PrevodPolozky[]
  originaly: { id: string; poradi: number }[]
  /** Položky, kvůli kterým databáze ruční doložení odmítne (`nevyresenePolozkyDolozeni` nad uloženými položkami). */
  nevyresenePolozky?: { poradi: number; nazev: string; duvod: string }[]
  /** Možné duplicity (mozneDuplicity nad záznamy téže pobočky ± 7 dní) — ukážou se u schválení. */
  duplicity: { zaznamId: string; duvod: string; jista: boolean; odkaz: string }[]
  /** Jednotka prodeje pokladny podle produktu, česky (jednotkaCesky). Chybí = neuvedena. */
  jednotkyProduktu: Record<string, string>
  muzeSchvalit: boolean
  vydej: { externiId: string | null; doklad: string | null }
  tedMs: number
  jmena: Record<string, string>
  zona: string
}) {
  const s = z.stavSkladu
  const zivy = navrh !== null && (navrh.stav === 'ceka_na_schvaleni' || navrh.stav === 'schvaleno')
  const schvalenyNavrh = navrh !== null && navrh.stav === 'schvaleno' ? navrh : null
  const kdo = (id: string | null) => (id ? (jmena[id] ?? 'kolega') : 'neznámo kdo')
  const nazevPokladny = pokladna?.nazev ?? 'pokladna záznamu'
  const plan = textPlanovaneOperace(pokladna?.skladovyVydej ?? 'rucne', pokladna?.nazevPoskytovatele ?? nazevPokladny, provozovna)
  const detailKontroly = (z.kontrolaSkladu?.detail ?? {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  /** Výdej je schválený a ještě neuzavřený (i předaný k ručnímu odpisu, s chybou nebo s nejasnou operací). */
  const schvalenyVydej = maPokladnu && SKLAD_SCHVALENY_NEUZAVRENY.includes(s)
  /** Co ručnímu doložení brání (zrcadlo databáze: nevyřešená POLOŽKA, ne změna katalogu). */
  const nevyreseneDolozeni = schvalenyVydej ? nevyresenePolozky : []
  const poradiNevyresenych = new Set(nevyreseneDolozeni.map((b) => b.poradi))
  /** Ostatní blokace náhledu u schváleného výdeje (celý výdej, katalog změněný po schválení) — jen upozorní. */
  const pozorSchvaleneho = schvalenyVydej && nahled ? nahled.blokace.filter((b) => b.poradi === null || !poradiNevyresenych.has(b.poradi)) : []
  const nabidnoutRucneDolozit = akce.has('rucne_dolozit') && nevyreseneDolozeni.length === 0
  const nejasnaOperace = operace !== null && OPERACE_NEJASNA.includes(operace.stav)
  /** Nejasná operace po vypršení platnosti: databáze pustí ruční doložení i zrušení schválení (C5) — `dostupneAkce` je nabídne. */
  const nejasnaPoPlatnosti = nejasnaOperace && (akce.has('rucne_dolozit') || akce.has('zrusit_schvaleni'))
  const konecDohledavani = operace?.platnostDo ? Date.parse(operace.platnostDo) + REZERVA_PO_PLATNOSTI_MS : NaN

  const seznamBlokaci = (blokace: BlokaceVydeje[]) => (
    <ul style={{ margin: 0, paddingLeft: '20px' }}>
      {blokace.map((b, i) => (
        <li key={i}>
          {b.poradi !== null ? `Položka ${b.poradi}${b.nazev ? ` (${b.nazev})` : ''}: ` : ''}
          {b.duvod}
        </li>
      ))}
    </ul>
  )
  const varovaniNahledu =
    nahled && nahled.varovani.length > 0 ? (
      <div role="note" style={{ display: 'grid', gap: '4px' }}>
        {nahled.varovani.map((v) => (
          <Vysvetleni key={v} dulezite>
            Upozornění: {v}
          </Vysvetleni>
        ))}
      </div>
    ) : null

  const seznamPolozek = (polozky: PolozkaVydeje[]) => (
    <ul style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '6px', fontSize: '14px' }}>
      {polozky.map((p) => {
        const zdroj = prevody.find((r) => r.poradi === p.poradi) ?? prevody.find((r) => r.posProduktId === p.posProduktId)
        return (
          <li key={`${p.poradi}-${p.posProduktId}`} style={{ overflowWrap: 'anywhere' }}>
            <strong>{p.nazev}</strong> — {mnozstviNaText(p.mnozstvi)}{' '}
            {jednotkyProduktu[p.posProduktId] ? `${jednotkyProduktu[p.posProduktId]} (jednotka prodeje pokladny)` : '(v jednotkách prodeje pokladny)'}
            <span style={{ display: 'block', fontSize: '13px', color: 'var(--muted)' }}>
              {zdroj ? `z dokladu: „${zdroj.nazev}“ ${zdroj.mnozstvi ? mnozstviNaText(zdroj.mnozstvi) : '?'} ${zdroj.jednotka ?? ''}` : ''}
              {zdroj ? ` · přiřazení ${zdroj.mapovani === 'overeno' ? 'ověřené' : zdroj.mapovani}` : ''} · produkt v pokladně {p.posProduktId}
            </span>
          </li>
        )
      })}
    </ul>
  )

  return (
    <section className="ds-plocha" style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
      <PanelHlava ikona="vozik" nadpis="Sklad (výdej v pokladně)" />
      <div>
        <ZnackaStavu popis={popisStavuSkladu(s)} />
      </div>
      <Vysvetleni dulezite>
        Odeslání ke schválení ani nahrání fotky sklad nemění. Sklad vede pokladna — „Odečteno v POS“ se ukáže jen po ověření v pokladně; ručně
        doložený výdej se tak nikdy nejmenuje.
      </Vysvetleni>

      {!maPokladnu ? <Vysvetleni>Záznam nemá pokladnu — výdej se v appce nepřipravuje. Spotřebu odepište v pokladně ručně.</Vysvetleni> : null}

      {/* ---------- Náhled a odeslání ke schválení ---------- */}
      {maPokladnu && nahled && (s === 'bez_navrhu' || s === 'zamitnuto' || s === 'nevyzaduje') ? (
        <Oddil nadpis="Návrh výdeje (sestavuje databáze z položek)">
          <Udaje>
            <Udaj nazev="Cílová pokladna">{nazevPokladny}</Udaj>
            <Udaj nazev="Provozovna v pokladně">{provozovna}</Udaj>
            <Udaj nazev="Sklad">podle nastavení provozovny v pokladně</Udaj>
          </Udaje>
          {nahled.polozky.length > 0 ? seznamPolozek(nahled.polozky) : <Vysvetleni>Žádná položka v pokladně sklad neodečítá (služby, spropitné, neskladové položky).</Vysvetleni>}
          {varovaniNahledu}
          {nahled.blokace.length > 0 ? (
            <div role="status" style={{ display: 'grid', gap: '4px', fontSize: '14px' }}>
              <strong style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <Ikona klic="varovani" velikost={16} /> Návrh zatím nejde odeslat:
              </strong>
              {seznamBlokaci(nahled.blokace)}
            </div>
          ) : akce.has('odeslat_sklad') ? (
            <FormularAkce akce={odeslatSklad} {...zakl} tlacitko="Odeslat ke schválení" vzhled="hlavni">
              <Vysvetleni>Návrh půjde ke schválení („Potvrdit výdej do POS“). Sklad se tím nemění.</Vysvetleni>
            </FormularAkce>
          ) : null}
        </Oddil>
      ) : null}

      {navrh && navrh.stav === 'zamitnuto' && s === 'zamitnuto' ? (
        <Vysvetleni>
          Výdej zamítl(a) {kdo(navrh.zamitl)}
          {navrh.zamitnuto ? ` ${datumACasSRokemVPasmu(navrh.zamitnuto, zona)}` : ''}
          {navrh.duvodZamitnuti ? ` — důvod: ${navrh.duvodZamitnuti}` : ''}. Upravte položky a odešlete znovu.
        </Vysvetleni>
      ) : null}

      {/* ---------- Potvrdit výdej do POS ---------- */}
      {zivy && navrh && navrh.stav === 'ceka_na_schvaleni' && (akce.has('rozhodnout_vydej') || akce.has('kontrola_skladu') || akce.has('prohlasit_sklad')) ? (
        <Oddil nadpis="Potvrdit výdej do POS">
          <Vysvetleni>
            Odeslal(a) {kdo(navrh.odeslal)} {datumACasSRokemVPasmu(navrh.odeslano, zona)}. Zkontrolujte originál, položky a přiřazení.
          </Vysvetleni>
          {originaly.length > 0 ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {originaly.map((o) => (
                <a key={o.id} href={`/api/jine-platby/soubor/${o.id}`} target="_blank" rel="noopener noreferrer" className="ft-tl ft-tl-vedlejsi">
                  Originál {o.poradi}
                </a>
              ))}
            </div>
          ) : null}
          {seznamPolozek(navrh.polozky)}
          {varovaniNahledu}
          <Udaje>
            <Udaj nazev="Cílová pokladna">{nazevPokladny}</Udaj>
            <Udaj nazev="Provozovna">{provozovna}</Udaj>
            <Udaj nazev="Sklad">podle nastavení provozovny v pokladně</Udaj>
          </Udaje>
          <div style={{ display: 'grid', gap: '6px' }}>
            <strong style={{ fontSize: '14px' }}>Plánovaná operace: {plan.nadpis}</strong>
            <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', display: 'grid', gap: '4px' }}>
              {plan.kroky.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ol>
          </div>

          <div style={{ display: 'grid', gap: '8px' }}>
            <strong style={{ fontSize: '14px' }}>Neodečetla už pokladna spotřebu sama?</strong>
            <VysledekKontroly
              kontrola={z.kontrolaSkladu}
              popisVysledku={POPIS_VYSLEDKU_SKLADU}
              verze={z.verze}
              platnostMin={PLATNOST_KONTROLY_SKLADU_MIN}
              tedMs={tedMs}
              jmena={jmena}
              zona={zona}
            />
            {akce.has('kontrola_skladu') ? (
              pokladna?.dohledaniUctu ? (
                <FormularAkce akce={zkontrolovatSklad} {...zakl} tlacitko="Zkontrolovat v pokladně">
                  <Vysvetleni>Kontrola platí 15 minut a jen pro tuhle verzi záznamu — dělá se těsně před potvrzením.</Vysvetleni>
                </FormularAkce>
              ) : (
                <Vysvetleni>{HLASKA_BEZ_DOHLEDANI}</Vysvetleni>
              )
            ) : null}
            {akce.has('prohlasit_sklad') ? <RucniProhlaseniSkladu zakl={zakl} z={z} smiOpravit={smiOpravit} /> : null}
          </div>

          {duplicity.length > 0 ? (
            <div style={{ display: 'grid', gap: '6px' }}>
              <strong style={{ fontSize: '14px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                <Ikona klic="varovani" velikost={16} /> Možné duplicity výdeje (záznamy téže provozovny ± 7 dní)
              </strong>
              <ul style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '6px', fontSize: '14px' }}>
                {duplicity.map((d) => (
                  <li key={d.zaznamId} style={{ overflowWrap: 'anywhere' }}>
                    <strong>{d.jista ? 'Jistá shoda' : 'Možná shoda'}:</strong> {d.duvod}.{' '}
                    <Link href={d.odkaz} className="ds-plocha-odkaz" style={{ marginLeft: 0 }}>
                      Otevřít ten záznam →
                    </Link>
                  </li>
                ))}
              </ul>
              <Vysvetleni>Kdyby šlo o tentýž prodej, sklad by se odečetl dvakrát. Když to duplicita není, napište při potvrzení proč.</Vysvetleni>
            </div>
          ) : null}

          {akce.has('rozhodnout_vydej') ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              {nahled && nahled.blokace.length > 0 ? (
                // Databáze schválení s nevyřešenou položkou odmítne — tlačítko nenabízet.
                <div role="status" style={{ display: 'grid', gap: '4px', fontSize: '14px' }}>
                  <strong style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <Ikona klic="varovani" velikost={16} /> Návrh má nevyřešené položky, schválit ho nejde:
                  </strong>
                  {seznamBlokaci(nahled.blokace)}
                </div>
              ) : muzeSchvalit ? (
                <FormularAkce
                  akce={rozhodnoutVydej}
                  {...zakl}
                  skryte={{ navrh: navrh.id, otisk: navrh.otisk, rozhodnuti: 'schvalit' }}
                  tlacitko="Potvrdit výdej do POS"
                  vzhled="hlavni"
                  potvrzeni={{
                    text: `Potvrzujete výdej ${navrh.polozky.length} položek do pokladny ${nazevPokladny}, provozovna ${provozovna}. ${
                      pokladna?.skladovyVydej === 'api'
                        ? 'Appka ho hned odešle a ověří dohledáním.'
                        : 'Pokladna zápis přes API neumí — výdej pak provedete v pokladně ručně a doložíte ho.'
                    } Zpět to jde jen korekcí.`,
                    ano: 'Ano, potvrdit výdej',
                  }}
                >
                  {nahled && nahled.varovani.length > 0 ? (
                    // Pokrm i kusové zboží: databáze schválí jen s výslovným potvrzením (p_bez_surovin).
                    <label style={{ display: 'flex', gap: '8px', alignItems: 'center', minHeight: '44px', fontSize: '14px', fontWeight: 600 }}>
                      <input type="checkbox" name="bez_surovin" value="ano" required />
                      <span>Zboží není surovina toho pokrmu (povinné — suroviny pokrmu odečte pokladna podle receptury sama)</span>
                    </label>
                  ) : null}
                  <PoleDuvodu
                    nazev="duplicita_duvod"
                    popisek="Proč to není duplicita (nepovinné)"
                    povinne={false}
                    napoveda="Vyplňte, když je podobný výdej téže provozovny už živý nebo provedený (stejný den a částka, nebo stejné číslo účtu) — databáze ho pak bez důvodu nepotvrdí."
                  />
                </FormularAkce>
              ) : z.stavKontroly !== 'zkontrolovano' ? (
                <Vysvetleni>Záznam se od odeslání upravil a není označený jako zkontrolovaný. Potvrdit výdej jde, až ho někdo znovu zkontroluje (Kontrola dokladu → Označit jako zkontrolované).</Vysvetleni>
              ) : (
                <Vysvetleni>Potvrdit výdej jde jen s čerstvou kontrolou (do 15 minut), že pokladna spotřebu neodečetla — dotazem do pokladny nebo ručním prohlášením.</Vysvetleni>
              )}
              <details>
                <summary style={{ cursor: 'pointer', fontSize: '14px', minHeight: '44px', display: 'flex', alignItems: 'center' }}>Zamítnout výdej</summary>
                <div style={{ marginTop: '8px' }}>
                  <FormularAkce akce={rozhodnoutVydej} {...zakl} skryte={{ navrh: navrh.id, otisk: navrh.otisk, rozhodnuti: 'zamitnout' }} tlacitko="Zamítnout" vycistit>
                    <PoleDuvodu popisek="Důvod zamítnutí (povinný)" />
                  </FormularAkce>
                </div>
              </details>
            </div>
          ) : null}
        </Oddil>
      ) : null}

      {/* ---------- Po schválení: operace ---------- */}
      {operace && s !== 'bez_navrhu' && s !== 'ceka_na_schvaleni' && s !== 'zamitnuto' ? (
        <Oddil nadpis="Výdej v pokladně">
          <Udaje>
            <Udaj nazev="Stav operace">{POPIS_OPERACE[operace.stav] ?? operace.stav}</Udaj>
            <Udaj nazev="Pokusů o odeslání">{operace.pokusu}</Udaj>
            <Udaj nazev="Připraveno">{datumACasSRokemVPasmu(operace.zahajeno, zona)}</Udaj>
            {operace.dokonceno ? <Udaj nazev="Uzavřeno">{datumACasSRokemVPasmu(operace.dokonceno, zona)}</Udaj> : null}
            {operace.externiDoklad || vydej.doklad ? <Udaj nazev="Doklad v pokladně">{operace.externiDoklad ?? vydej.doklad}</Udaj> : null}
            {operace.externiId || vydej.externiId ? <Udaj nazev="ID v pokladně">{operace.externiId ?? vydej.externiId}</Udaj> : null}
          </Udaje>
          {operace.chyba ? <Vysvetleni>{operace.chyba}</Vysvetleni> : null}
          {operace.duvod ? <Vysvetleni>Důvod: {operace.duvod}</Vysvetleni> : null}
          {s === 'nepodporovano' || (s === 'schvaleno' && pokladna?.skladovyVydej !== 'api') ? (
            <div style={{ display: 'grid', gap: '6px' }}>
              <strong style={{ fontSize: '14px' }}>{plan.nadpis}</strong>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', display: 'grid', gap: '4px' }}>
                {plan.kroky.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ol>
              {navrh && zivy ? seznamPolozek(navrh.polozky) : null}
              {varovaniNahledu}
            </div>
          ) : null}
          {akce.has('provest_vydej') ? (
            <FormularAkce
              akce={provestVydej}
              {...zakl}
              tlacitko="Provést výdej"
              vzhled="hlavni"
              potvrzeni={{ text: 'Výdej se odešle do pokladny jednou a ověří se dohledáním. Pokračovat?', ano: 'Ano, provést' }}
            />
          ) : null}
          {akce.has('obnovit_vydej') ? (
            <FormularAkce akce={obnovitVydej} {...zakl} tlacitko="Dohledat v pokladně">
              <Vysvetleni>Nic se neposílá znovu — appka jen hledá v pokladně výdej s klíčem této operace.</Vysvetleni>
            </FormularAkce>
          ) : null}
          {nejasnaPoPlatnosti ? (
            <Vysvetleni dulezite>
              Požadavek do pokladny má nejasný výsledek a jeho platnost vypršela{operace.platnostDo ? ` (${datumACasSRokemVPasmu(operace.platnostDo, zona)})` : ''}. Než
              cokoli doložíte nebo zrušíte, ověřte v pokladně, jestli výdej s klíčem této operace proběhl: když ano, použijte „Ručně doloženo“ s číslem
              dokladu z pokladny; když v pokladně nic odepsáno není, „Zrušit schválení“.
            </Vysvetleni>
          ) : nejasnaOperace && akce.has('obnovit_vydej') && Number.isFinite(konecDohledavani) ? (
            <Vysvetleni>
              Do {datumACasSRokemVPasmu(new Date(konecDohledavani).toISOString(), zona)} (platnost požadavku a 2 minuty rezerva) se výdej jen dohledává — pokladna ho může
              ještě provést. Potom půjde po ověření v pokladně ručně doložit, nebo schválení zrušit.
            </Vysvetleni>
          ) : null}
          {akce.has('vydej_znovu') ? (
            <FormularAkce
              akce={vydejZnovu}
              {...zakl}
              tlacitko="Zkusit výdej znovu"
              potvrzeni={{ text: 'Pokladna předchozí požadavek prokazatelně neprovedla. Připraví se nový a hned se odešle. Pokračovat?', ano: 'Ano, zkusit znovu' }}
            />
          ) : null}
        </Oddil>
      ) : null}

      {/* ---------- Doložení bez automatického ověření ---------- */}
      {akce.has('kontrola_skladu') && s !== 'ceka_na_schvaleni' ? (
        <Oddil nadpis="Kontrola v pokladně">
          <VysledekKontroly
            kontrola={z.kontrolaSkladu}
            popisVysledku={POPIS_VYSLEDKU_SKLADU}
            verze={z.verze}
            platnostMin={PLATNOST_KONTROLY_SKLADU_MIN}
            tedMs={tedMs}
            jmena={jmena}
            zona={zona}
          />
          {pokladna?.dohledaniUctu ? <FormularAkce akce={zkontrolovatSklad} {...zakl} tlacitko="Zkontrolovat v pokladně" /> : <Vysvetleni>{HLASKA_BEZ_DOHLEDANI}</Vysvetleni>}
          {akce.has('prohlasit_sklad') ? <RucniProhlaseniSkladu zakl={zakl} z={z} smiOpravit={smiOpravit} /> : null}
        </Oddil>
      ) : null}

      {/* ---------- Schválený výdej s nevyřešenou položkou (databáze doložení odmítne) ---------- */}
      {nevyreseneDolozeni.length > 0 ? (
        <div role="status" style={{ display: 'grid', gap: '4px', fontSize: '14px' }}>
          <strong style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <Ikona klic="varovani" velikost={16} /> Návrh výdeje má nevyřešené položky — ručně doložit ho teď nejde:
          </strong>
          {seznamBlokaci(nevyreseneDolozeni)}
          <Vysvetleni>
            Položky, které se týkají skladu, ve schváleném výdeji měnit nejde. Když jste v pokladně nic neodepsali, schvalovatel schválení zruší
            („Zrušit schválení“), položky se opraví a výdej se pošle znovu.
          </Vysvetleni>
        </div>
      ) : null}
      {/* ---------- Schválený výdej: blokace celého výdeje nebo katalog změněný po schválení (doložení nebrání) ---------- */}
      {pozorSchvaleneho.length > 0 ? (
        <div role="status" style={{ display: 'grid', gap: '4px', fontSize: '14px' }}>
          <strong style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <Ikona klic="varovani" velikost={16} /> Pozor u výdeje:
          </strong>
          {seznamBlokaci(pozorSchvaleneho)}
          {pozorSchvaleneho.some((b) => b.poradi !== null) ? (
            <Vysvetleni>
              Katalog pokladny se od schválení změnil (produkt v pokladně zrušili, nebo katalog není načtený). Ručně doložit jde dál — doloží se to, co
              bylo schváleno a v pokladně odepsáno.
            </Vysvetleni>
          ) : null}
        </div>
      ) : null}

      {nabidnoutRucneDolozit ? (
        <Oddil nadpis="Ručně doloženo">
          <FormularAkce
            akce={rucneDolozit}
            {...zakl}
            // Otisk ŽIVÉHO schváleného návrhu — databáze ho porovná (doloží se jen to, co bylo schválené a vidět).
            skryte={schvalenyNavrh ? { otisk: schvalenyNavrh.otisk } : undefined}
            tlacitko="Ručně doloženo"
            vycistit
          >
            <Vysvetleni>
              {nejasnaPoPlatnosti
                ? 'Jen když jste v pokladně ověřili, že výdej z tohoto návrhu proběhl (nebo jste ho tam provedli sami). '
                : 'Použijte, až výdej provedete v pokladně sami. '}
              Stav bude „Ručně doloženo (neověřeno pokladnou)“ — není to automatické ověření.
            </Vysvetleni>
            <label className="ds-field">
              <span className="ds-field-label">Číslo dokladu z pokladny (výdejka, odpis)</span>
              <input className="ds-input" style={VSTUP} name="doklad" required maxLength={100} />
            </label>
            <PoleDuvodu />
          </FormularAkce>
        </Oddil>
      ) : null}

      {akce.has('zrusit_schvaleni') ? (
        <Oddil nadpis="Zrušit schválení">
          <FormularAkce
            akce={zrusitSchvaleni}
            {...zakl}
            tlacitko="Zrušit schválení (v pokladně nic neodepsáno)"
            vzhled="nebezpecne"
            vycistit
            potvrzeni={{
              text: 'Potvrzujete, že v pokladně se z tohoto návrhu NIC neodepsalo. Schválení se zruší, návrh se nahradí a sklad bude zpět „bez návrhu“ — výdej pak půjde připravit znovu. Pokračovat?',
              ano: 'Ano, zrušit schválení',
            }}
          >
            <Vysvetleni>
              Jen když v pokladně nic odepsáno nebylo (třeba je potřeba změnit položky — ve schváleném výdeji to nejde). Když už v pokladně odepsáno
              je, nerušte schválení — použijte „Ručně doloženo“ s číslem dokladu z pokladny.
            </Vysvetleni>
            <PoleDuvodu popisek="Důvod zrušení (povinný)" napoveda="Například: „V pokladně jsem nic neodepsal, množství piva je špatně, opravím a pošlu znovu.“" />
          </FormularAkce>
        </Oddil>
      ) : null}

      {akce.has('propojit_vydej') ? (
        <Oddil nadpis="Pokladna už odečetla — propojit">
          <FormularAkce akce={propojitVydej} {...zakl} tlacitko="Propojit (nic znovu neodečítat)" vycistit>
            <Vysvetleni>Kontrola ukázala, že pokladna spotřebu odečetla sama. Výdej z appky se nevytvoří, záznam se jen propojí.</Vysvetleni>
            <div style={MRIZKA_POLI}>
              <label className="ds-field">
                <span className="ds-field-label">ID v pokladně</span>
                <input className="ds-input" style={VSTUP} name="externi_id" maxLength={100} defaultValue={text(detailKontroly.externi_id)} />
              </label>
              <label className="ds-field">
                <span className="ds-field-label">Číslo dokladu</span>
                <input className="ds-input" style={VSTUP} name="doklad" maxLength={100} defaultValue={text(detailKontroly.doklad)} />
              </label>
            </div>
            <PoleDuvodu />
          </FormularAkce>
        </Oddil>
      ) : null}

      {akce.has('korekce_vydeje') ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '14px', minHeight: '44px', display: 'flex', alignItems: 'center' }}>Korekce provedeného výdeje</summary>
          <div style={{ marginTop: '8px' }}>
            <FormularAkce
              akce={korekceVydeje}
              {...zakl}
              tlacitko="Zapsat korekci"
              vzhled="nebezpecne"
              potvrzeni={{ text: 'Korekci nejdřív proveďte v pokladně (opravný doklad). Tady ji jen zapíšete — původní výdej zůstane v historii. Pokračovat?', ano: 'Ano, zapsat korekci' }}
            >
              <label className="ds-field">
                <span className="ds-field-label">Číslo opravného dokladu z pokladny</span>
                <input className="ds-input" style={VSTUP} name="doklad" required maxLength={100} />
              </label>
              <PoleDuvodu />
            </FormularAkce>
          </div>
        </details>
      ) : null}
    </section>
  )
}

/**
 * Ruční prohlášení ke skladu. Proti poslednímu výsledku pokladny „už
 * odečetla“ (`prohlaseniProtiPokladne`, bez ohledu na verzi) se
 * „neodečetla“ nabízí jen s právem na opravy a s povinným zaškrtnutím
 * `prepsat_pokladnu` (databáze bez nich odmítne, akce taky).
 */
function RucniProhlaseniSkladu({ zakl, z, smiOpravit }: { zakl: { zaznam: string; verze: number; rozsah: string }; z: ZaznamJinePlatby; smiOpravit: boolean }) {
  const proti = prohlaseniProtiPokladne(z, 'sklad')
  const popisProti = proti === null ? null : ((POPIS_VYSLEDKU_SKLADU as Record<string, string>)[proti.vysledek] ?? proti.vysledek)
  const neniNelze = proti !== null && proti.chceOpravu && !smiOpravit
  const volby: [string, string][] = [
    ['je', 'už odečetla (prodej je v pokladně uzavřený, nebo výdej už proběhl)'],
    ...(neniNelze
      ? []
      : ([['neni', proti !== null ? 'neodečetla (prodej nebo výdej v pokladně je jiný — přepíše výsledek pokladny)' : 'neodečetla (ověřeno v pokladně)']] as [string, string][])),
    ['nevim', 'nevím — nic nezapisovat'],
  ]
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: '14px', minHeight: '44px', display: 'flex', alignItems: 'center' }}>Ruční prohlášení s důvodem</summary>
      <div style={{ marginTop: '8px' }}>
        <FormularAkce akce={prohlasitSklad} {...zakl} tlacitko="Zapsat ruční prohlášení" vycistit>
          {proti !== null ? (
            <Vysvetleni dulezite>
              {neniNelze
                ? `Pokladna při kontrole našla: ${popisProti} (ověřeno dotazem do pokladny). Konkrétní prodej nebo odpis ručním prohlášením „neodečetla“ přepsat smí jen člověk s právem na opravy, proto se tu nenabízí — když si myslíte, že se pokladna mýlí, zopakujte kontrolu v pokladně, nebo dejte vědět tomu, kdo opravy dělá.`
                : `Pokladna při kontrole našla: ${popisProti} (ověřeno dotazem do pokladny).${proti.chceOpravu ? ' Konkrétní prodej nebo odpis přepisujete s právem na opravy.' : ''} Prohlášení „neodečetla“ výsledek pokladny přepíše jen se zaškrtnutím, že prodej nebo výdej v pokladně je jiný — zapíše se to do historie s vaším jménem. Nejdřív radši kontrolu v pokladně zopakujte.`}
            </Vysvetleni>
          ) : null}
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '4px' }}>
            <legend className="ds-field-label" style={{ marginBottom: '4px' }}>
              Spotřebu z tohoto dokladu pokladna
            </legend>
            {volby.map(([hodnota, popis]) => (
              <label key={hodnota} style={{ display: 'flex', gap: '8px', alignItems: 'center', minHeight: '44px', fontSize: '14px' }}>
                <input type="radio" name="vysledek" value={hodnota} required />
                <span>{popis}</span>
              </label>
            ))}
          </fieldset>
          {proti !== null && !neniNelze ? (
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', minHeight: '44px', fontSize: '14px', fontWeight: 600 }}>
              <input type="checkbox" name="prepsat_pokladnu" value="ano" />
              <span>Prodej nebo výdej v pokladně je jiný, ověřil(a) jsem to (povinné u „neodečetla“)</span>
            </label>
          ) : null}
          <PoleDuvodu />
          <Vysvetleni>Ruční prohlášení se ukáže jako ruční (pokladnou neověřené), s vaším jménem a důvodem. Platí 15 minut.</Vysvetleni>
        </FormularAkce>
      </div>
    </details>
  )
}
