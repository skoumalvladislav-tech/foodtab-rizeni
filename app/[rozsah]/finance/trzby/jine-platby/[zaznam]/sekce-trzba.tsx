import Link from 'next/link'

import { datumACasSRokemVPasmu } from '@/lib/cas'
import { formatHaleru } from '@/lib/jine-platby-castky'
import { moznaDvakrat, moznaNikde, popisStavuTrzby, prohlaseniProtiPokladne, type AkceJinePlatby } from '@/lib/jine-platby-stav'
import { PLATNOST_KONTROLY_TRZBY_MIN, type ZaznamJinePlatby } from '@/lib/jine-platby-typy'

import { PanelHlava } from '../../../../dnes/prvky'
import Ikona from '../../../../ikona'
import { opravitTrzbu, potvrditTrzbu, prohlasitTrzbu } from '../akce'
import { zkontrolovatTrzbu } from '../akce-pos'
import ZnackaStavu from '../znacka-stavu'
import FormularAkce from './formular-akce'
import { datumCesky, HLASKA_BEZ_DOHLEDANI, POPIS_VYSLEDKU_TRZBY, propojeniChceDuvod } from './logika'
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
 *
 * Po zápisu jde kontrola v pokladně zopakovat (dodatečná kontrola — účet
 * se mohl v pokladně uzavřít až potom); po propojení jen u propojení
 * s KONKRÉTNÍM prodejem (`z.posProdejId` — propojení bez něj kontrola
 * znovu nenajde, rozhoduje `dostupneAkce`). Když pokladna u zapsané tržby
 * prodej najde (`moznaDvakrat`), sekce výrazně varuje a vede na storno;
 * když propojený prodej nenajde (`moznaNikde`), varuje a radí ho nejdřív
 * ověřit v pokladně (účet mohl být zrušený nebo přečíslovaný) — žádná rada
 * „zapište jako novou“ (R1: vedla ke dvojí tržbě).
 *
 * „Jen propojit“ bez konkrétního prodeje v pokladně (kontrola bez
 * `pos_prodej_id`, kromě ručního prohlášení „je“) má POVINNÉ pole „Proč je
 * prodej v pokladně“ (`duvod_propojeni`) — databáze bez něj propojení
 * odmítne (`propojeniChceDuvod`).
 *
 * Ruční prohlášení „není“ proti poslednímu výsledku dotazu do pokladny
 * (`prohlaseniProtiPokladne`, bez ohledu na verzi): u „pravděpodobně“ jen
 * s povinným zaškrtnutím „Prodej v pokladně je jiný, ověřil(a) jsem to“
 * (`prepsat_pokladnu`); u „nalezeno“ totéž a navíc jen s právem na opravy —
 * bez něj se „není“ nenabízí a obrazovka řekne proč.
 *
 * Pole „Proč to není duplicita“ je u zápisu i propojení VŽDY: databáze
 * hledá šířeji než obrazovka (u firemní pokladny i jiné pobočky), takže
 * duplicitu může najít, i když tady žádná vidět není.
 */
export default function SekceTrzba({
  zakl,
  z,
  akce,
  maPokladnu,
  umiDohledani,
  smiOpravit,
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
  /** Právo na opravy (`jine_platby.oprava`) na pobočce záznamu — smí přepsat výsledek pokladny ručním prohlášením. */
  smiOpravit: boolean
  duplicity: { zaznamId: string; duvod: string; jista: boolean; odkaz: string }[]
  trzby: RadekTrzby[]
  tedMs: number
  jmena: Record<string, string>
  zona: string
}) {
  const vysledek = z.kontrolaTrzby?.vysledek ?? null
  const castka = z.castkaHaleru !== null ? formatHaleru(z.castkaHaleru, z.mena) : 'neuvedeno'
  const dvakrat = moznaDvakrat(z)
  const nikde = moznaNikde(z)
  const poZapisu = z.stavTrzby === 'zapsano'
  const poPropojeni = z.stavTrzby === 'propojeno'
  const proti = prohlaseniProtiPokladne(z, 'trzba')
  const popisProti = proti === null ? null : ((POPIS_VYSLEDKU_TRZBY as Record<string, string>)[proti.vysledek] ?? proti.vysledek)
  /** „Není“ proti výsledku pokladny: u „nalezeno“ jen s právem na opravy (databáze jinak odmítne). */
  const neniNelze = proti !== null && proti.chceOpravu && !smiOpravit
  const chceDuvodPropojeni = vysledek !== 'nenalezeno' && propojeniChceDuvod(z.kontrolaTrzby, maPokladnu)
  const volbyProhlaseni: [string, string][] = [
    ['je', 'je (prodej je v pokladně — tržba se jen propojí)'],
    ...(neniNelze
      ? []
      : ([[
          'neni',
          proti !== null ? 'není (prodej v pokladně je jiný — přepíše výsledek pokladny)' : 'není (prodej proběhl mimo pokladnu)',
        ]] as [string, string][])),
    ['nevim', 'nevím — nic nezapisovat'],
  ]

  return (
    <section className="ds-plocha" style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
      <PanelHlava ikona="mince" nadpis="Tržba (Ostatní tržby)" />
      <div>
        <ZnackaStavu popis={popisStavuTrzby(z.stavTrzby)} />
      </div>

      {dvakrat ? (
        <div
          role="alert"
          style={{
            display: 'grid',
            gap: '8px',
            padding: '12px 14px',
            borderRadius: '12px',
            border: '1px solid var(--pozor)',
            background: 'var(--pozor-bg)',
            color: 'var(--ink)',
          }}
        >
          <p style={{ margin: 0, display: 'flex', gap: '8px', alignItems: 'flex-start', fontWeight: 700, fontSize: '15px', lineHeight: 1.4 }}>
            <span aria-hidden="true" style={{ flex: 'none', paddingTop: '2px' }}>
              <Ikona klic="varovani" velikost={18} />
            </span>
            <span style={{ minWidth: 0 }}>Pokladna tento prodej má — tržba je možná zapsaná dvakrát. Ověřte a případně stornujte Ostatní tržbu.</span>
          </p>
          {akce.has('opravit_trzbu') ? (
            <a href="#oprava-trzby" className="ds-plocha-odkaz" style={{ marginLeft: 0 }}>
              Opravit nebo stornovat tržbu →
            </a>
          ) : (
            <span style={{ fontSize: '13.5px' }}>Storno smí provést ten, kdo má oprávnění na opravy a storna Jiných plateb — dejte mu vědět.</span>
          )}
        </div>
      ) : null}

      {nikde ? (
        <div
          role="alert"
          style={{
            display: 'grid',
            gap: '8px',
            padding: '12px 14px',
            borderRadius: '12px',
            border: '1px solid var(--pozor)',
            background: 'var(--pozor-bg)',
            color: 'var(--ink)',
          }}
        >
          <p style={{ margin: 0, display: 'flex', gap: '8px', alignItems: 'flex-start', fontWeight: 700, fontSize: '15px', lineHeight: 1.4 }}>
            <span aria-hidden="true" style={{ flex: 'none', paddingTop: '2px' }}>
              <Ikona klic="varovani" velikost={18} />
            </span>
            <span style={{ minWidth: 0 }}>
              Pozdější kontrola propojený prodej v pokladně nenašla — ověřte ho v pokladně (účet mohl být zrušený nebo přečíslovaný).
            </span>
          </p>
          <span style={{ fontSize: '13.5px' }}>
            Teprve když tam opravdu není, opravte tržbu. Záznam je propojený s účtem {z.posProdejId ?? 'v pokladně'} a do součtu se nepřičetl.
          </span>
          {akce.has('opravit_trzbu') ? (
            <a href="#oprava-trzby" className="ds-plocha-odkaz" style={{ marginLeft: 0 }}>
              Opravit nebo stornovat propojení →
            </a>
          ) : (
            <span style={{ fontSize: '13.5px' }}>Storno smí provést ten, kdo má oprávnění na opravy a storna Jiných plateb — dejte mu vědět.</span>
          )}
        </div>
      ) : null}

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
                {poZapisu
                  ? 'Dodatečná kontrola: tržba je zapsaná v Ostatních tržbách. Appka se znovu zeptá pokladny, jestli tenhle prodej mezitím nemá (účet se mohl uzavřít až po zápisu) — pak by byl v tržbách dvakrát.'
                  : poPropojeni
                    ? `Dodatečná kontrola: prodej je propojený s účtem ${z.posProdejId ?? 'v pokladně'} (do součtu se nepřičetl). Appka se znovu zeptá pokladny, jestli ho opravdu má.`
                    : 'Appka se zeptá pokladny na účty provozovny uzavřené kolem dne prodeje (den před až dva dny po) a na otevřené účty, a hledá číslo účtu z dokladu. Shoda částky (i po zaokrouhlení hotovosti) stačí jen na „pravděpodobně“; odpisy se za prodej nepočítají. „Není v pokladně“ umí kontrola říct jen u uzavřeného prodeje a ručního seznamu spotřeby — u sjetiny a neurčeného dokladu jen ruční prohlášení s důvodem.'}
              </Vysvetleni>
            </FormularAkce>
          ) : (
            <Vysvetleni>{HLASKA_BEZ_DOHLEDANI}</Vysvetleni>
          )
        ) : poPropojeni && maPokladnu && !z.posProdejId ? (
          <Vysvetleni>Tržba je propojená bez konkrétního účtu v pokladně (s důvodem) — dodatečná kontrola by ho nenašla, proto se nenabízí.</Vysvetleni>
        ) : null}
        {!maPokladnu && z.stavTrzby === 'nezapsano' ? <Vysvetleni>Záznam nemá pokladnu — doložte ručně, jestli prodej v pokladně je.</Vysvetleni> : null}

        {akce.has('prohlasit_trzbu') ? (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '14px', minHeight: '44px', display: 'flex', alignItems: 'center' }}>Ruční prohlášení s důvodem</summary>
            <div style={{ marginTop: '8px' }}>
              <FormularAkce akce={prohlasitTrzbu} {...zakl} tlacitko="Zapsat ruční prohlášení" vycistit>
                {proti !== null ? (
                  <Vysvetleni dulezite>
                    {neniNelze
                      ? `Pokladna při kontrole našla: ${popisProti} (ověřeno dotazem do pokladny). Konkrétní prodej ručním prohlášením „není“ přepsat smí jen člověk s právem na opravy, proto se tu nenabízí — když si myslíte, že se pokladna mýlí, zopakujte kontrolu v pokladně, nebo dejte vědět tomu, kdo opravy dělá.`
                      : `Pokladna při kontrole našla: ${popisProti} (ověřeno dotazem do pokladny).${proti.chceOpravu ? ' Konkrétní prodej přepisujete s právem na opravy.' : ''} Prohlášení „není“ výsledek pokladny přepíše jen se zaškrtnutím, že prodej v pokladně je jiný — zapíše se to do historie s vaším jménem. Nejdřív radši kontrolu v pokladně zopakujte.`}
                  </Vysvetleni>
                ) : null}
                <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '4px' }}>
                  <legend className="ds-field-label" style={{ marginBottom: '4px' }}>
                    Prodej v pokladně
                  </legend>
                  {volbyProhlaseni.map(([hodnota, text]) => (
                    <label key={hodnota} style={{ display: 'flex', gap: '8px', alignItems: 'center', minHeight: '44px', fontSize: '14px' }}>
                      <input type="radio" name="vysledek" value={hodnota} required />
                      <span>{text}</span>
                    </label>
                  ))}
                </fieldset>
                {proti !== null && !neniNelze ? (
                  <label style={{ display: 'flex', gap: '8px', alignItems: 'center', minHeight: '44px', fontSize: '14px', fontWeight: 600 }}>
                    <input type="checkbox" name="prepsat_pokladnu" value="ano" />
                    <span>Prodej v pokladně je jiný, ověřil(a) jsem to (povinné u „není“)</span>
                  </label>
                ) : null}
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
            {chceDuvodPropojeni ? (
              <PoleDuvodu
                nazev="duvod_propojeni"
                popisek="Proč je prodej v pokladně (povinné)"
                napoveda="Kontrola nenašla konkrétní účet v pokladně (shoda jen částky, nebo to nešlo ověřit). Napište, podle čeho víte, že je prodej v tržbách pokladny — třeba číslo účtu, které jste v pokladně dohledali. Bez toho by se tržba mimo pokladnu nezapočítala nikde."
              />
            ) : null}
            {vysledek === 'nenalezeno' && z.stavFaktury === 'propojena' && z.fakturaZdroj === 'pos' ? (
              <Vysvetleni dulezite>
                K záznamu je propojená faktura vystavená v pokladně — tržbu z ní má pokladna sama. Novou tržbu databáze nepustí; fakturu odpojte, nebo
                prodej jen propojte.
              </Vysvetleni>
            ) : null}
            <PoleDuvodu
              nazev="duplicita_duvod"
              popisek="Proč to není duplicita (nepovinné)"
              povinne={false}
              napoveda="Vyplňte, když je podobný prodej už zapsaný — databáze hledá i mimo tuto obrazovku (u firemní pokladny i na jiných pobočkách) a bez důvodu zápis nepustí."
            />
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
        <details id="oprava-trzby" open={dvakrat || nikde}>
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
