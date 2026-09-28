import Link from 'next/link'

import Ikona from '../../ikona'
import Nadpis from '../../nadpis'
import TlacitkoOdeslat from '../../vzkazy/tlacitko-odeslat'
import { ulozitNastaveni, ulozitZarizeniPush, zrusitZarizeniPush } from './akce'
import PushPrepinac from './push-prepinac'

/**
 * Obrazovka Nastavení upozornění — jen vykreslení (27. 9.).
 *
 * Data dodá `page.tsx`; komponenta nesahá do databáze, takže se dá
 * vykreslit i v dočasném náhledu. Vzhled podle mockupu Dnes: karty
 * `.ds-plocha`, ikony ze sdílené sady, žádné emoji (do 27. 9. „🔒“).
 *
 * Jen dvě kategorie jdou vypnout: vzkazy a nástěnka. Změny směn se tu
 * VŮBEC NENABÍZEJÍ jako vypnutelné — noční zadání to výslovně zakazuje
 * a `app.upozorneni_povoleno` se z `app.upozornit_smenu()` nevolá, takže
 * vypnutí nejde obejít ani přímým zápisem do tabulky. Další kategorie
 * (úkoly, checklisty, zálohy, zapomenutý odchod, e-mail) čekají na
 * rozhodnutí Šéfíka (otázka 27) — do té doby se pravdivě píše, že
 * vypnout nejdou.
 */

export type Kategorie = 'vzkazy' | 'nastenka'

const POPIS: Record<Kategorie, { nazev: string; vysvetleni: string }> = {
  vzkazy: {
    nazev: 'Zprávy v rozhovorech',
    vysvetleni:
      'Upozornění na novou zprávu v rozhovoru, kanálu pobočky nebo úseku a ve vzkazu vedení. Naléhavá zpráva přijde vždycky.',
  },
  nastenka: {
    nazev: 'Nástěnka',
    vysvetleni: 'Upozornění na nové oznámení na Nástěnce.',
  },
}

export default function ObsahNastaveniUpozorneni({
  rozsah,
  povoleno,
  chyba,
  ulozeno,
  jeMajitel,
  verejnyKlic,
}: {
  rozsah: string
  povoleno: Record<Kategorie, boolean>
  chyba: string | null
  ulozeno: boolean
  jeMajitel: boolean
  /** Veřejný klíč VAPID (veřejný z definice), nebo null. */
  verejnyKlic: string | null
}) {
  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Co vám má chodit do zvonečku a do telefonu."
        vpravo={
          <Link href={`/${rozsah}/upozorneni`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
            <Ikona klic="sipkaVlevo" /> Upozornění
          </Link>
        }
      >
        Upozornění
      </Nadpis>

      <div className="ds-nu" style={{ padding: '16px', paddingBottom: '32px', maxWidth: '620px' }}>
        {chyba ? (
          <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
            {chyba}
          </p>
        ) : ulozeno ? (
          <p className="ds-nu-ok" role="status">
            <Ikona klic="fajfkaKruh" /> Uloženo.
          </p>
        ) : null}

        <form action={ulozitNastaveni} className="ds-plocha">
          <div className="ds-plocha-hlava">
            <Ikona klic="zvonek" />
            <h2>Co chci dostávat</h2>
          </div>
          <input type="hidden" name="rozsah" value={rozsah} />

          <div className="ds-nu-seznam">
            {(Object.keys(POPIS) as Kategorie[]).map((kat) => (
              <label key={kat} className="ds-nu-radek">
                <input type="checkbox" name={kat} value="ano" defaultChecked={povoleno[kat]} />
                <span>
                  <strong>{POPIS[kat].nazev}</strong>
                  <span>{POPIS[kat].vysvetleni}</span>
                </span>
              </label>
            ))}

            {/*
              Informace, ne přepínač. Zadání výslovně zakazuje, aby šlo
              tohle vypnout — nabízet zaškrtávátko, které by beztak nic
              neudělalo, by bylo jen klamavé.
            */}
            <div className="ds-nu-radek" data-zamceno="1">
              <Ikona klic="zamek" />
              <span>
                <strong>Změny mých směn</strong>
                <span>
                  Změny vašich směn chodí vždy, nejdou vypnout — nová, změněná,
                  odebraná i zrušená směna.
                </span>
              </span>
            </div>
            <div className="ds-nu-radek" data-zamceno="1">
              <Ikona klic="zamek" />
              <span>
                <strong>Úkoly, checklisty, zálohy a zapomenutý odchod</strong>
                <span>Tahle upozornění chodí vždy, zatím se vypnout nedají.</span>
              </span>
            </div>
          </div>

          <div style={{ marginTop: '16px' }}>
            <TlacitkoOdeslat className="ft-tl ft-tl-hlavni" pracuje="Ukládám…">
              Uložit
            </TlacitkoOdeslat>
          </div>
        </form>

        {/*
          Upozornění do telefonu. Soukromý klíč VAPID zůstává na serveru
          a sem se nedostane.
        */}
        <PushPrepinac
          verejnyKlic={verejnyKlic}
          ulozit={ulozitZarizeniPush}
          zrusit={zrusitZarizeniPush}
          jeMajitel={jeMajitel}
        />
      </div>
    </>
  )
}
