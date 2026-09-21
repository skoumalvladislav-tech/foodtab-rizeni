import Link from 'next/link'

import Ikona from '@/app/[rozsah]/ikona'
import { datumACasVPasmu, hodinaVPasmu } from '@/lib/cas'
import { mmss } from '@/lib/hlasove-zpravy'
import { popisStavuPrepisu } from '@/lib/komunikace/prepis'
import type { PolozkaVlakna, ZpravaVlakna } from '@/lib/komunikace/vlakno'
import { slovoPodleCisla } from '@/lib/upozorneni-text'
import { stornovatZpravu } from '../akce'

/**
 * Vlákno rozhovoru — jen vykreslení.
 *
 * Skládání (dny, dělítko „Nové“, seskupení) dělá čistá funkce
 * `poskladatVlakno`; tady se položky jen kreslí. Komponenta nesahá do
 * databáze, takže se dá vykreslit i mimo přihlášenou aplikaci (dočasný
 * náhled na snímky obrazovky).
 *
 * OBSAH SE NESCHOVÁVÁ ani mimo směnu — pravidlo o doručení chrání před
 * vyrušením, ne před informací (viz stránka rozhovoru).
 *
 * Priorita je vidět třikrát: hranou bubliny, slovem („NALÉHAVÉ“,
 * „DŮLEŽITÉ“) a v panelu. Barva nikdy sama.
 */

export type ZpravaUI = ZpravaVlakna & {
  text: string
  priorita: 'normal' | 'important' | 'urgent'
  stornovana: boolean
  /** Podepsaný odkaz na hlasovku, nebo null. */
  zvukOdkaz: string | null
  zvukDelkaS: number | null
  /** Zpráva je hlasovka (i když se odkaz nepodařilo vystavit). */
  maZvuk: boolean
  objektTyp: string | null
  objektId: string | null
}

const STITKY: Record<'important' | 'urgent', string> = {
  important: 'DŮLEŽITÉ',
  urgent: 'NALÉHAVÉ',
}

export default function VlaknoZprav({
  rozsah,
  konverzace,
  polozky,
  jmena,
  zona,
  smiUkoly,
}: {
  rozsah: string
  konverzace: string
  polozky: PolozkaVlakna<ZpravaUI>[]
  /** employees.id → jméno. */
  jmena: Record<string, string>
  zona: string
  /** Smí přihlášený zakládat úkoly (tasks.manage)? Jen pak se nabízí „Vytvořit úkol“. */
  smiUkoly: boolean
}) {
  if (polozky.length === 0) {
    return (
      <div className="pc-vlakno-prazdne">
        <p style={{ margin: 0 }}>Zatím tu nikdo nic nenapsal. Napište první zprávu.</p>
      </div>
    )
  }

  return (
    <div className="pc-vlakno" role="log" aria-label="Zprávy v rozhovoru">
      {polozky.map((p, i) => {
        if (p.druh === 'den') {
          return (
            <div key={`den-${p.klic}-${i}`} className="pc-den">
              {p.popis}
            </div>
          )
        }

        if (p.druh === 'nove') {
          return (
            <div key={`nove-${i}`} className="pc-nove" id="nove">
              {p.pocet}{' '}
              {slovoPodleCisla(p.pocet, 'nová zpráva', 'nové zprávy', 'nových zpráv')}
            </div>
          )
        }

        if (p.druh === 'udalost') {
          const z = p.zprava
          const cas = hodinaVPasmu(z.vytvoreno, zona)
          const obsah = (
            <>
              <Ikona klic="fajfkaKruh" />
              <span>
                {z.text} · {cas}
              </span>
            </>
          )
          return z.objektTyp === 'ukol' && z.objektId ? (
            <Link
              key={z.id}
              id={`z-${z.id}`}
              className="pc-udalost"
              href={`/${rozsah}/ukoly/ukol/${z.objektId}`}
            >
              {obsah}
            </Link>
          ) : (
            <div key={z.id} id={`z-${z.id}`} className="pc-udalost">
              {obsah}
            </div>
          )
        }

        const z = p.zprava
        const autor = z.autor ? (jmena[z.autor] ?? 'kdosi') : 'systém'
        const stitek = z.priorita === 'normal' ? null : STITKY[z.priorita]
        const prepis = popisStavuPrepisu(null)

        return (
          <div
            key={z.id}
            id={`z-${z.id}`}
            className={`pc-zprava${p.moje ? ' moje' : ''}`}
            data-priorita={z.priorita}
            data-stornovana={z.stornovana ? '1' : undefined}
          >
            {p.zacatekSkupiny ? (
              <p className="pc-zprava-meta">
                <strong>{p.moje ? 'Vy' : autor}</strong> · {hodinaVPasmu(z.vytvoreno, zona)}
              </p>
            ) : null}

            <div className="pc-bublina" title={datumACasVPasmu(z.vytvoreno, zona)}>
              {stitek ? (
                <span className="pc-stitek" data-druh={z.priorita}>
                  {stitek}
                </span>
              ) : null}
              {z.text}
              {z.stornovana ? <span className="pc-zprava-meta"> · staženo</span> : null}

              {z.maZvuk ? (
                <div className="pc-hlasovka">
                  {z.zvukOdkaz ? (
                    <audio controls preload="none" src={z.zvukOdkaz} />
                  ) : (
                    <small>Hlasovku se nepodařilo načíst.</small>
                  )}
                  <small>
                    Hlasová zpráva{z.zvukDelkaS ? ` · ${mmss(z.zvukDelkaS)}` : ''} · {prepis.text}
                  </small>
                </div>
              ) : null}
            </div>

            {!z.stornovana && (smiUkoly || p.moje) ? (
              <div className="pc-akce-zpravy">
                {smiUkoly ? (
                  <Link href={`/${rozsah}/vzkazy/${konverzace}/ukol?zprava=${z.id}`}>
                    Vytvořit úkol
                  </Link>
                ) : null}
                {p.moje ? (
                  <form action={stornovatZpravu}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="konverzace" value={konverzace} />
                    <input type="hidden" name="zprava" value={z.id} />
                    <button type="submit">Stáhnout</button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
