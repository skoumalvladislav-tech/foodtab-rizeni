import Link from 'next/link'

import { datumACasSRokemVPasmu } from '@/lib/cas'
import { formatHaleru } from '@/lib/jine-platby-castky'
import { popisStavuTrzby, type AkceJinePlatby } from '@/lib/jine-platby-stav'
import { PLATNOST_KONTROLY_TRZBY_MIN, type ZaznamJinePlatby } from '@/lib/jine-platby-typy'

import { PanelHlava } from '../../../../dnes/prvky'
import { opravitTrzbu, potvrditTrzbu, prohlasitTrzbu } from '../akce'
import { zkontrolovatTrzbu } from '../akce-pos'
import ZnackaStavu from '../znacka-stavu'
import FormularAkce from './formular-akce'
import { datumCesky, HLASKA_BEZ_DOHLEDANI, POPIS_VYSLEDKU_TRZBY } from './logika'
import { MRIZKA_POLI, Oddil, PoleDuvodu, VSTUP, VysledekKontroly, Vysvetleni } from './prvky'

export type RadekTrzby = {
  id: string
  castkaHaleru: number
  mena: string
  datum: string
  zapocitat: boolean
  stav: 'platna' | 'stornovana'
  potvrdil: string | null
  potvrzeno: string
  stornoDuvod: string | null
  stornovano: string | null
}

/**
 * Sekce (b) Tržba (Ostatní tržby).
 *
 * Tržba se uznává JEDNOU: prodej, který už je v pokladně, se jen propojí
 * (do součtu se nepřičte); do Ostatních tržeb se zapíše jen prodej,
 * u kterého kontrola (dotaz do pokladny, nebo ruční prohlášení s důvodem)
 * řekla „v pokladně není“. Ruční prohlášení se nikdy nevydává za ověření
 * pokladnou. Fotka sjetiny nic neříká o tom, jestli host zaplatil.
 */
export default function SekceTrzba({
  zakl,
  z,
  akce,
  maPokladnu,
  umiDohledani,
  duplicity,
  trzby,
  tedMs,
  jmena,
  zona,
}: {
  zakl: { zaznam: string; verze: number; rozsah: string }
  z: ZaznamJinePlatby
  akce: ReadonlySet<AkceJinePlatby>
  maPokladnu: boolean
  umiDohledani: boolean
  duplicity: { zaznamId: string; duvod: string; jista: boolean; odkaz: string }[]
  trzby: RadekTrzby[]
  tedMs: number
  jmena: Record<string, string>
  zona: string
}) {
  const vysledek = z.kontrolaTrzby?.vysledek ?? null
  const castka = z.castkaHaleru !== null ? formatHaleru(z.castkaHaleru, z.mena) : 'neuvedeno'

  return (
    <section className="ds-plocha" style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
      <PanelHlava ikona="mince" nadpis="Tržba (Ostatní tržby)" />
      <div>
        <ZnackaStavu popis={popisStavuTrzby(z.stavTrzby)} />
      </div>
      <Vysvetleni dulezite>
        Fotografie sjetiny nedokazuje přijetí peněz. Tržba se uznává jednou: prodej, který už je v pokladně, se jen propojí; do Ostatních tržeb se
        zapíše jen prodej mimo pokladnu. Zaplacení ověří až bankovní platba.
      </Vysvetleni>

      {/* ---------- Kontrola proti pokladně ---------- */}
      <Oddil nadpis="Je prodej v pokladně?">
        <VysledekKontroly
          kontrola={z.kontrolaTrzby}
          popisVysledku={POPIS_VYSLEDKU_TRZBY}
          verze={z.verze}
          platnostMin={PLATNOST_KONTROLY_TRZBY_MIN}
          tedMs={tedMs}
          jmena={jmena}
          zona={zona}
        />
        {akce.has('kontrola_trzby') ? (
          umiDohledani ? (
            <FormularAkce akce={zkontrolovatTrzbu} {...zakl} tlacitko="Zkontrolovat v pokladně">
              <Vysvetleni>
                Appka se zeptá pokladny na účty provozovny kolem dne prodeje (± 1 den) a hledá číslo účtu z dokladu. Samotná shoda částky stačí jen na
                „pravděpodobně“.
              </Vysvetleni>
            </FormularAkce>
          ) : (
            <Vysvetleni>{HLASKA_BEZ_DOHLEDANI}</Vysvetleni>
          )
        ) : null}
        {!maPokladnu && z.stavTrzby === 'nezapsano' ? <Vysvetleni>Záznam nemá pokladnu — doložte ručně, jestli prodej v pokladně je.</Vysvetleni> : null}

        {akce.has('prohlasit_trzbu') ? (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '14px', minHeight: '44px', display: 'flex', alignItems: 'center' }}>Ruční prohlášení s důvodem</summary>
            <div style={{ marginTop: '8px' }}>
              <FormularAkce akce={prohlasitTrzbu} {...zakl} tlacitko="Zapsat ruční prohlášení" vycistit>
                <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '4px' }}>
                  <legend className="ds-field-label" style={{ marginBottom: '4px' }}>
                    Prodej v pokladně
                  </legend>
                  {[
                    ['je', 'je (prodej je v pokladně — tržba se jen propojí)'],
                    ['neni', 'není (prodej proběhl mimo pokladnu)'],
                    ['nevim', 'nevím — nic nezapisovat'],
                  ].map(([hodnota, text]) => (
                    <label key={hodnota} style={{ display: 'flex', gap: '8px', alignItems: 'center', minHeight: '44px', fontSize: '14px' }}>
                      <input type="radio" name="vysledek" value={hodnota} required />
                      <span>{text}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="ds-field">
                  <span className="ds-field-label">ID účtu nebo číslo dokladu v pokladně (povinné u „je“)</span>
                  <input className="ds-input" style={VSTUP} name="pos_prodej_id" maxLength={100} defaultValue={z.externiUcet ?? ''} />
                </label>
                <PoleDuvodu napoveda="Například: „Ověřil jsem v pokladně, účet č. 1234 je uzavřený“ nebo „Prodej na akci mimo provozovnu, do pokladny se nemarkoval“." />
                <Vysvetleni>Ruční prohlášení se ukáže jako ruční (pokladnou neověřené), s vaším jménem a důvodem. Platí 30 minut.</Vysvetleni>
              </FormularAkce>
            </div>
          </details>
        ) : null}
      </Oddil>

      {/* ---------- Možné duplicity ---------- */}
      {duplicity.length > 0 ? (
        <Oddil nadpis="Možné duplicity">
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
          <Vysvetleni>Kdyby to byl tentýž prodej, zapsal by se dvakrát. Když to duplicita není, napište při zápisu proč.</Vysvetleni>
        </Oddil>
      ) : null}

      {/* ---------- Zápis ---------- */}
      {akce.has('potvrdit_trzbu') ? (
        <Oddil nadpis={vysledek === 'nenalezeno' ? 'Zapsat do Ostatních tržeb' : 'Jen propojit s pokladnou'}>
          <FormularAkce
            akce={potvrditTrzbu}
            {...zakl}
            skryte={{ rezim: vysledek === 'nenalezeno' ? 'nova' : 'propojit' }}
            tlacitko={vysledek === 'nenalezeno' ? 'Zapsat do Ostatních tržeb' : 'Jen propojit (do součtu se nepřičte)'}
            vzhled="hlavni"
          >
            <Vysvetleni>
              {vysledek === 'nenalezeno'
                ? `Zapíše se nová tržba ${castka} ze dne ${datumCesky(z.datumProdeje)} na tuto provozovnu a započítá se do tržeb.`
                : `Prodej už je v tržbách pokladny (nebo to nejde vyloučit). Záznam se jen propojí — ${castka} se do součtu podruhé nepřičte. Když víte, že prodej v pokladně není, doložte to ručním prohlášením „není“ — pak půjde zapsat jako nová tržba.`}
            </Vysvetleni>
            {duplicity.length > 0 ? (
              <PoleDuvodu nazev="duplicita_duvod" popisek="Proč to není duplicita" povinne={false} napoveda="Povinné, když je podobný prodej už zapsaný v Ostatních tržbách — databáze to pak bez důvodu nepustí." />
            ) : null}
          </FormularAkce>
        </Oddil>
      ) : null}

      {/* ---------- Zapsané tržby ---------- */}
      {trzby.length > 0 ? (
        <Oddil nadpis="Zápis v Ostatních tržbách">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px', fontSize: '14px' }}>
            {trzby.map((t) => (
              <li key={t.id} style={{ overflowWrap: 'anywhere', color: t.stav === 'stornovana' ? 'var(--muted)' : 'var(--ink)' }}>
                <strong>{formatHaleru(t.castkaHaleru, t.mena)}</strong> · {datumCesky(t.datum)} ·{' '}
                {t.zapocitat ? 'zapsáno, započítává se' : 'propojeno s pokladnou, nezapočítává se'}
                {' · '}
                {t.potvrdil ? (jmena[t.potvrdil] ?? 'kolega') : 'neznámo kdo'}, {datumACasSRokemVPasmu(t.potvrzeno, zona)}
                {t.stav === 'stornovana' ? (
                  <span style={{ display: 'block' }}>
                    Stornováno{t.stornovano ? ` ${datumACasSRokemVPasmu(t.stornovano, zona)}` : ''}
                    {t.stornoDuvod ? ` — ${t.stornoDuvod}` : ''}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Oddil>
      ) : null}

      {/* ---------- Oprava / storno ---------- */}
      {akce.has('opravit_trzbu') ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '14px', minHeight: '44px', display: 'flex', alignItems: 'center' }}>Opravit nebo stornovat tržbu</summary>
          <div style={{ marginTop: '8px' }}>
            <FormularAkce
              akce={opravitTrzbu}
              {...zakl}
              tlacitko="Opravit / stornovat"
              vzhled="nebezpecne"
              potvrzeni={{
                text: 'Původní řádek tržby se stornuje (zůstane v historii). S vyplněnou částkou vznikne nový řádek s opravenou částkou, s prázdnou jen storno. Pokračovat?',
                ano: 'Ano, provést opravu',
              }}
            >
              <div style={MRIZKA_POLI}>
                <label className="ds-field">
                  <span className="ds-field-label">Opravená částka (prázdné = jen storno)</span>
                  <input className="ds-input" style={VSTUP} name="castka" inputMode="decimal" />
                </label>
                <label className="ds-field">
                  <span className="ds-field-label">
                    Číslo opravného dokladu{z.stavFaktury === 'propojena' ? ' (povinné — k záznamu je propojená faktura)' : ''}
                  </span>
                  <input className="ds-input" style={VSTUP} name="doklad_opravy" maxLength={100} required={z.stavFaktury === 'propojena'} />
                </label>
              </div>
              <PoleDuvodu />
            </FormularAkce>
          </div>
        </details>
      ) : null}
    </section>
  )
}
