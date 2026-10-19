import { datumACasSRokemVPasmu } from '@/lib/cas'
import { formatHaleru, mnozstviNaText } from '@/lib/jine-platby-castky'
import type { KontrolaDokladu } from '@/lib/jine-platby-kontrola'
import { popisDruhu, popisStavuKontroly, popisTypuDokladu, type AkceJinePlatby } from '@/lib/jine-platby-stav'
import type { PolozkaNavrhu, ZaznamJinePlatby } from '@/lib/jine-platby-typy'

import { PanelHlava } from '../../../../dnes/prvky'
import Ikona from '../../../../ikona'
import { oznacitZkontrolovano, ulozitNavrh } from '../akce'
import { rozpoznat } from '../akce-ai'
import { nacistKatalog } from '../akce-pos'
import ZnackaStavu from '../znacka-stavu'
import EditorNavrhu, { type HlavickaEditoru, type PolozkaEditoru, type ProduktEditoru } from './editor-navrhu'
import FormularAkce from './formular-akce'
import { datumCesky, HLASKA_BEZ_AI, popisPuvoduCastky, type BodKontroly } from './logika'
import { Oddil, PoleDuvodu, Udaj, Udaje, Vysvetleni } from './prvky'

const ZNACKA_BODU: Record<BodKontroly['blokuje'], string> = {
  ano: 'Blokuje označení',
  bez_potvrzeni: 'Blokuje bez potvrzení',
  bez_duvodu: 'Blokuje bez důvodu',
  ne: 'Jen upozornění',
}

const POPIS_NOVEJSIHO_POKUSU: Record<string, string> = {
  ok: 'doklad přečetl, ale návrh se z něj neuložil',
  chyba: 'skončil chybou',
  bezi: 'ještě běží, nebo se přerušil',
  bez_klice: 'neproběhl (AI není zapnutá)',
}

/**
 * Sekce (a) Kontrola dokladu: hlavička, rozpoznání přes AI, přehled
 * částek z dokladu (co je tržba a co ne), položky s úpravou a „Označit
 * jako zkontrolované". Nic z toho nezapisuje tržbu ani sklad.
 *
 * Panel „Částky na dokladu“ je z rozpoznání, ZE KTERÉHO JE ULOŽENÝ NÁVRH
 * (stránka ho vybere: poslední úspěšné, jehož verze záznamu je starší než
 * ta dnešní) — ne z posledního pokusu. Novější neúspěšný, běžící nebo
 * neuložený pokus a ruční úpravy od toho čtení řekne větou.
 *
 * Upozornění AI k celému dokladu (`z.upozorneniDokladu`) jsou v „Co
 * zkontrolovat“ první („Blokuje bez potvrzení“) a formulář označení má
 * pak povinné zaškrtnutí „Upozornění AI jsem prověřil(a)“.
 */
export default function SekceKontrola({
  zakl,
  z,
  akce,
  smiUpravit,
  editor,
  polozky,
  rozpoznani,
  kontrolaRozpoznani,
  puvodCastek,
  coZkontrolovat,
  nesoulad,
  ai,
  katalog,
  zona,
}: {
  zakl: { zaznam: string; verze: number; rozsah: string }
  z: ZaznamJinePlatby
  akce: ReadonlySet<AkceJinePlatby>
  smiUpravit: boolean
  editor: { hlavicka: HlavickaEditoru; polozky: PolozkaEditoru[]; katalog: ProduktEditoru[]; kontakty: { id: string; nazev: string; ico: string | null }[] | null }
  polozky: PolozkaNavrhu[]
  /** Poslední pokus o rozpoznání (jakýkoli stav). */
  rozpoznani: { stav: string; vytvoreno: string; duvod: string | null } | null
  /** Kontrola rozpoznání, ze kterého je uložený návrh (`null` = žádné takové). */
  kontrolaRozpoznani: KontrolaDokladu | null
  /** Odkud jsou částky: čas toho čtení, novější pokusy po něm, ruční úpravy návrhu od něj. */
  puvodCastek?: { vytvoreno: string; novejsi: { stav: string; vytvoreno: string }[]; upravenoPotom: boolean } | null
  /** Co v uloženém návrhu zkontrolovat a co z toho označení blokuje (coZkontrolovat nad daty z databáze). */
  coZkontrolovat: BodKontroly[]
  /** Součet položek nesedí s celkovou cenou → povinné „Proč rozdíl nevadí“ (popis rozdílu), jinak `null`. */
  nesoulad: string | null
  ai: { zapnuto: boolean; pocetSouboru: number }
  /** `chyba` = katalog nebo ověřená přiřazení nejdou načíst celé (chyba dotazu, strop stránek) — žádný tichý ořez. */
  katalog: { umi: boolean; pocet: number; aktualizovano: string | null; chyba: string | null } | null
  zona: string
}) {
  const castka = (h: number | null) => (h === null ? 'neuvedeno' : formatHaleru(h, z.mena))
  const k = kontrolaRozpoznani
  const zruseno = z.stavKontroly === 'zruseno'
  const trzbaZapsana = z.stavTrzby === 'zapsano' || z.stavTrzby === 'propojeno'
  const upozorneniAi = z.upozorneniDokladu.filter((u) => typeof u === 'string' && u.trim() !== '')
  // Schválený / ručně zpracovávaný výdej: položky pro sklad databáze nepustí změnit (jine_platby_ulozit_navrh).
  const zamekSkladu = z.stavSkladu === 'schvaleno' || z.stavSkladu === 'nepodporovano' ? z.stavSkladu : null
  const novejsi = puvodCastek?.novejsi[0] ?? null

  return (
    <section className="ds-plocha" style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
      <PanelHlava ikona="seznam" nadpis="Kontrola dokladu" />
      <div>
        <ZnackaStavu popis={popisStavuKontroly(z.stavKontroly)} />
      </div>

      <Udaje>
        <Udaj nazev="Datum prodeje (provozní den)">{z.datumProdeje ? datumCesky(z.datumProdeje) : 'neuvedeno'}</Udaj>
        <Udaj nazev="Označení">{z.oznaceni || '—'}</Udaj>
        <Udaj nazev="Měna">{z.mena ?? 'neuvedena (nedomýšlí se)'}</Udaj>
        <Udaj nazev="Celková cena prodeje">
          <span className="ds-cislo" style={{ fontSize: '17px' }}>
            {castka(z.castkaHaleru)}
          </span>
          {z.castkaHaleru !== null ? <span style={{ color: 'var(--muted)', fontSize: '13px' }}> · {popisPuvoduCastky(z.castkaPuvod)}</span> : null}
        </Udaj>
        <Udaj nazev="Typ dokladu">{popisTypuDokladu(z.typDokladu)}</Udaj>
        <Udaj nazev="Číslo účtu / dokladu">{z.externiUcet ?? '—'}</Udaj>
      </Udaje>

      {/* ---------- Rozpoznání přes AI ---------- */}
      {smiUpravit && !zruseno ? (
        <Oddil nadpis="Rozpoznání z dokladu">
          {!ai.zapnuto ? (
            <Vysvetleni>{HLASKA_BEZ_AI}</Vysvetleni>
          ) : ai.pocetSouboru === 0 ? (
            <Vysvetleni>Nejdřív nahrajte fotku nebo PDF dokladu (vlevo). Bez dokladu zadejte položky ručně.</Vysvetleni>
          ) : akce.has('rozpoznat') ? (
            <FormularAkce
              akce={rozpoznat}
              {...zakl}
              tlacitko="Rozpoznat z dokladu"
              vzhled={polozky.length === 0 ? 'hlavni' : 'vedlejsi'}
              potvrzeni={
                polozky.length > 0
                  ? {
                      text: `Rozpoznání nahradí současné položky (${polozky.length}) a údaje, které na dokladu přečte. Co nepřečte, zůstane, jak je; uložený provozní den taky (když AI přečte jiné datum, upozorní na to). Pokračovat?`,
                      ano: 'Ano, rozpoznat znovu',
                    }
                  : undefined
              }
            >
              <Vysvetleni>
                Snímky dokladu se pošlou ke čtení schválené AI službě Anthropic — nic jiného (žádná jména, ceník ani další údaje z appky). Výsledek je
                jen návrh: nic se nezapíše do tržeb ani do skladu, dokud ho nezkontrolujete. Čtení trvá až dvě minuty.
              </Vysvetleni>
            </FormularAkce>
          ) : trzbaZapsana ? (
            <Vysvetleni>Tržba je už zapsaná nebo propojená — nové rozpoznání by měnilo potvrzené údaje. Případné chyby opravte ručně (oprava tržby).</Vysvetleni>
          ) : null}
          {rozpoznani ? (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Naposledy: {datumACasSRokemVPasmu(rozpoznani.vytvoreno, zona)} —{' '}
              {rozpoznani.stav === 'ok' ? 'přečteno' : rozpoznani.stav === 'bezi' ? 'probíhá' : rozpoznani.stav === 'bez_klice' ? 'AI není zapnutá' : 'nepovedlo se'}
              {rozpoznani.stav === 'chyba' && rozpoznani.duvod ? `: ${rozpoznani.duvod}` : ''}
            </p>
          ) : null}
        </Oddil>
      ) : null}

      {/* ---------- Částky z dokladu (z rozpoznání, ze kterého je uložený návrh) ---------- */}
      {k ? (
        <Oddil nadpis="Částky na dokladu (z rozpoznání, ze kterého je návrh)">
          {puvodCastek ? (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>Čtení z {datumACasSRokemVPasmu(puvodCastek.vytvoreno, zona)}.</p>
          ) : null}
          {novejsi ? (
            <Vysvetleni dulezite>
              Novější pokus o rozpoznání ({datumACasSRokemVPasmu(novejsi.vytvoreno, zona)}) {POPIS_NOVEJSIHO_POKUSU[novejsi.stav] ?? 'neskončil úspěchem'} — částky níž
              jsou z dřívějšího čtení, ze kterého je uložený návrh.
            </Vysvetleni>
          ) : null}
          {puvodCastek?.upravenoPotom ? (
            <Vysvetleni dulezite>Návrh se od toho čtení ručně upravil — částky na dokladu nemusí sedět s uloženými údaji výš.</Vysvetleni>
          ) : null}
          <Vysvetleni dulezite>
            Do tržby jde jen celková cena prodeje (zboží a služby po slevách, bez spropitného). „K úhradě“ ani přijatá hotovost tržba nejsou — host mohl
            platit zálohu, doplácet nebo dostat zpátky.
          </Vysvetleni>
          <Udaje>
            <Udaj nazev="Celkem — cena prodeje (jde do tržby)">{castka(k.castky.celkem)}</Udaj>
            <Udaj nazev="K úhradě (není tržba)">{castka(k.castky.kUhrade)}</Udaj>
            <Udaj nazev="Zaplaceno">{castka(k.castky.zaplaceno)}</Udaj>
            <Udaj nazev="Zbývá doplatit">{castka(k.castky.zbyva)}</Udaj>
            <Udaj nazev="Přijato hotově (není tržba)">{castka(k.castky.prijatoHotove)}</Udaj>
            <Udaj nazev="Vráceno">{castka(k.castky.vraceno)}</Udaj>
            <Udaj nazev="Sleva">{castka(k.castky.sleva)}</Udaj>
            <Udaj nazev="Spropitné (nepatří do ceny prodeje)">{castka(k.castky.spropitne)}</Udaj>
            <Udaj nazev="Součet položek">{castka(k.soucetPolozekHaleru)}</Udaj>
          </Udaje>
          {k.navrhCelkem ? (
            <Vysvetleni dulezite>
              Celková cena na dokladu chybí. Vypočtený součet položek {castka(k.navrhCelkem.haleru)} je jen návrh — potvrďte ho v úpravě níž („Použít
              součet jako návrh celkové ceny“).
            </Vysvetleni>
          ) : null}
          {k.nesoulad ? <p className="hlaska-vareni" style={{ margin: 0 }}>{k.nesoulad.popis}</p> : null}
          {k.duvody.length > 0 ? (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '14px', minHeight: '44px', display: 'flex', alignItems: 'center' }}>Upozornění z kontroly dokladu ({k.duvody.length})</summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: '20px', fontSize: '13.5px' }}>
                {k.duvody.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </Oddil>
      ) : null}

      {/* ---------- Položky ---------- */}
      <Oddil nadpis="Položky a přiřazení k pokladně">
        {smiUpravit && akce.has('upravit') ? (
          <EditorNavrhu akce={ulozitNavrh} {...zakl} mena={z.mena} zamekSkladu={zamekSkladu} {...editor} />
        ) : polozky.length === 0 ? (
          <Vysvetleni>Záznam zatím nemá položky.</Vysvetleni>
        ) : (
          <ol style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '8px', fontSize: '14px' }}>
            {polozky.map((p, i) => (
              <li key={i} style={{ background: p.vyzadujeKontrolu ? 'color-mix(in srgb, var(--pozor) 8%, transparent)' : undefined, overflowWrap: 'anywhere' }}>
                <strong>{p.nazev}</strong> · {p.mnozstvi ? mnozstviNaText(p.mnozstvi) : '? '}
                {p.jednotka ?? ''} · {p.cenaCelkemHaleru !== null ? castka(p.cenaCelkemHaleru) : 'cena chybí'} · {popisDruhu(p.druh)}
                {p.posProduktNazev ? ` · v pokladně: ${p.posProduktNazev}${p.mapovani === 'overeno' ? ' (ověřeno)' : ' (návrh)'}` : ''}
                {p.vyzadujeKontrolu ? (
                  <span style={{ display: 'block', color: 'var(--pozor)', fontSize: '13px' }}>
                    <Ikona klic="varovani" velikost={14} /> {p.duvodKontroly || 'Ke kontrole'}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}

        {katalog?.chyba ? (
          <p role="alert" className="hlaska-chyba" style={{ margin: 0 }}>
            {katalog.chyba} Přiřazení k produktům pokladny teď nejde; zkuste stránku načíst znovu.
          </p>
        ) : null}
        {katalog && smiUpravit && !zruseno ? (
          <div style={{ display: 'grid', gap: '8px' }}>
            <Vysvetleni>
              Katalog pokladny: {katalog.pocet > 0 ? `${katalog.pocet} produktů` : 'zatím nenačtený'}
              {katalog.aktualizovano ? `, aktualizováno ${datumACasSRokemVPasmu(katalog.aktualizovano, zona)}` : ''}. Přiřazení podle podobnosti názvu je jen návrh;
              ověřené přiřazení dělá člověk.
            </Vysvetleni>
            {katalog.umi && akce.has('upravit') ? <FormularAkce akce={nacistKatalog} {...zakl} tlacitko="Načíst katalog z pokladny" /> : null}
            {!katalog.umi ? <Vysvetleni>Tahle pokladna katalog neposílá — položky přiřazujte podle názvů z prodeje; výdej pak jen ručně.</Vysvetleni> : null}
          </div>
        ) : null}
      </Oddil>

      {/* ---------- Upozornění AI, když označení zatím není na řadě (chybí datum, měna…) ---------- */}
      {!akce.has('oznacit_zkontrolovano') && upozorneniAi.length > 0 && !zruseno && z.stavKontroly !== 'zkontrolovano' ? (
        <Oddil nadpis="Upozornění AI k dokladu">
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '4px', fontSize: '13.5px' }}>
            {upozorneniAi.map((u, i) => (
              <li key={i} style={{ overflowWrap: 'anywhere' }}>
                {u}
              </li>
            ))}
          </ul>
          <Vysvetleni>Před označením jako zkontrolované je bude potřeba prověřit a potvrdit.</Vysvetleni>
        </Oddil>
      ) : null}

      {/* ---------- Zkontrolováno ---------- */}
      {akce.has('oznacit_zkontrolovano') ? (
        <Oddil nadpis="Označit jako zkontrolované">
          {coZkontrolovat.length > 0 ? (
            <div style={{ display: 'grid', gap: '6px', fontSize: '13.5px' }}>
              <strong style={{ fontSize: '14px' }}>Co zkontrolovat (podle uloženého návrhu)</strong>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px' }}>
                {coZkontrolovat.map((b, i) => (
                  <li key={`${b.blokuje}-${i}`} data-blokuje={b.blokuje} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', overflowWrap: 'anywhere' }}>
                    <span aria-hidden="true" style={{ flex: 'none', paddingTop: '1px', color: b.blokuje === 'ne' ? 'var(--muted)' : 'var(--pozor)' }}>
                      <Ikona klic={b.blokuje === 'ne' ? 'vykricnik' : 'varovani'} velikost={16} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ fontWeight: b.blokuje === 'ne' ? 500 : 700 }}>{ZNACKA_BODU[b.blokuje]}:</strong> {b.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <FormularAkce akce={oznacitZkontrolovano} {...zakl} tlacitko="Označit jako zkontrolované" vzhled="hlavni">
            <Vysvetleni>
              Potvrzujete, že datum prodeje, měna, celková cena a položky sedí s dokladem. Tím se nic nezapíše do tržeb ani do skladu — to jsou další
              kroky.
            </Vysvetleni>
            {upozorneniAi.length > 0 ? (
              <label style={{ display: 'flex', gap: '8px', alignItems: 'center', minHeight: '44px', fontSize: '14px', fontWeight: 600 }}>
                <input type="checkbox" name="upozorneni_provereno" value="ano" required />
                <span>Upozornění AI jsem prověřil(a) (povinné — {upozorneniAi.length === 1 ? 'jedno upozornění' : `upozornění: ${upozorneniAi.length}`} v „Co zkontrolovat“)</span>
              </label>
            ) : null}
            {nesoulad ? (
              <PoleDuvodu
                nazev="duvod_rozdilu"
                popisek="Proč rozdíl nevadí (povinné)"
                napoveda={`${nesoulad}. Například zaokrouhlení hotovosti nebo sleva mimo položky. Když rozdíl vadí, opravte položky nebo celkovou cenu výš.`}
              />
            ) : null}
          </FormularAkce>
        </Oddil>
      ) : null}
    </section>
  )
}
