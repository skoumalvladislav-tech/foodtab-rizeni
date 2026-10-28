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
 *
 * Ranní přehled rezervací (27. 10. 2026) se nabízí jen tomu, kdo
 * rezervace na některé pobočce vidí — nikomu jinému nepřijde, takže by
 * mu zaškrtávátko jen překáželo. Které kategorie formulář nabídl, nese
 * skryté pole `nabidnuto`: co se nenabídlo, akce nepřepíše na „vypnuto“.
 */

export type Kategorie = 'vzkazy' | 'nastenka' | 'rezervace_souhrn'

/** Co se nabízí každému. */
export const ZAKLADNI_KATEGORIE: Kategorie[] = ['vzkazy', 'nastenka']

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
  rezervace_souhrn: {
    nazev: 'Ranní přehled rezervací',
    vysvetleni:
      'Každé ráno kolik je dnes rezervací a hostů a jaké akce jsou v plánu — za pobočky, kde rezervace vidíte. Když není nic v plánu, nepřijde nic.',
  },
}

export default function ObsahNastaveniUpozorneni({
  rozsah,
  povoleno,
  nabidnout = ZAKLADNI_KATEGORIE,
  chyba,
  ulozeno,
  jeMajitel,
  verejnyKlic,
}: {
  rozsah: string
  povoleno: Partial<Record<Kategorie, boolean>>
  /** Které kategorie se tomuhle člověku nabízejí (výchozí: vzkazy a nástěnka). */
  nabidnout?: Kategorie[]
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
          <input type="hidden" name="nabidnuto" value={nabidnout.join(',')} />

          <div className="ds-nu-seznam">
            {nabidnout.map((kat) => (
              <label key={kat} className="ds-nu-radek">
                {/* Chybějící řádek v databázi = zapnuto (app.upozorneni_povoleno). */}
                <input type="checkbox" name={kat} value="ano" defaultChecked={povoleno[kat] ?? true} />
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
