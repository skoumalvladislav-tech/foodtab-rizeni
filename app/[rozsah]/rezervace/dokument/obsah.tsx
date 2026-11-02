import Link from 'next/link'
import type { ReactNode } from 'react'

import { datumACasSRokemVPasmu } from '@/lib/cas'
import type { Blok, NahledDocx, Odstavec, Usek } from '@/lib/docx-nahled'
import { velikostText } from '@/lib/rezervace-prilohy'
import { pocet } from '@/lib/sklonovani'

import Ikona from '../../ikona'
import Nadpis from '../../nadpis'
import { ZalozkyRezervaci } from '../prvky'

/**
 * Náhled dokumentu Word — ČISTĚ KRESLICÍ jako obsah.tsx o úroveň výš.
 * Data a přístup řeší dokument/[id]/page.tsx.
 *
 * Obsah dokumentu je strom obyčejných dat z lib/docx-nahled.ts a kreslí
 * se jako text (React ho escapuje). Žádné vkládání HTML — dokument je
 * cizí soubor.
 */

function Text({ u }: { u: Usek }) {
  if (u.zastupny) return <span className="ds-dokument-obrazek">{u.text}</span>
  let obsah: ReactNode = u.text
  if (u.podtrzeno) obsah = <u>{obsah}</u>
  if (u.kurziva) obsah = <em>{obsah}</em>
  if (u.tucne) obsah = <strong>{obsah}</strong>
  return obsah
}

function Texty({ p }: { p: Odstavec }) {
  return p.useky.map((u, i) => <Text key={i} u={u} />)
}

/** Nadpisy dokumentu jsou o úroveň níž než nadpis stránky (název souboru). */
const NADPISY = { 1: 'h2', 2: 'h3', 3: 'h4' } as const

export function ObsahDokumentu({ bloky }: { bloky: Blok[] }) {
  const vysledek: ReactNode[] = []
  for (let i = 0; i < bloky.length; i++) {
    const b = bloky[i]
    if (b.druh === 'tabulka') {
      vysledek.push(
        <div key={i} className="ds-dokument-tabulka">
          <table>
            <tbody>
              {b.radky.map((radek, r) => (
                <tr key={r}>
                  {radek.map((bunka, c) => (
                    <td key={c}>
                      <ObsahDokumentu bloky={bunka} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
    } else if (b.nadpis) {
      const H = NADPISY[b.nadpis]
      vysledek.push(
        <H key={i}>
          <Texty p={b} />
        </H>,
      )
    } else if (b.odrazka) {
      // Odrážky za sebou jsou jeden seznam.
      const polozky: Odstavec[] = []
      while (i < bloky.length) {
        const dalsi = bloky[i]
        if (dalsi.druh !== 'odstavec' || dalsi.nadpis || !dalsi.odrazka) break
        polozky.push(dalsi)
        i++
      }
      i--
      vysledek.push(
        <ul key={i}>
          {polozky.map((p, j) => (
            <li key={j}>
              <Texty p={p} />
            </li>
          ))}
        </ul>,
      )
    } else {
      vysledek.push(
        b.useky.length ? (
          <p key={i}>
            <Texty p={b} />
          </p>
        ) : (
          <p key={i} className="ds-dokument-mezera" aria-hidden="true" />
        ),
      )
    }
  }
  return vysledek
}

export function DokumentObsah({
  rozsah,
  priloha,
  zona,
  kCemu,
  zpet,
  nahled,
  chyba,
}: {
  rozsah: string
  priloha: { id: string; nazev: string; velikost: number; nahrano: string }
  zona: string
  /** „Novákovi · čt 5. 11. · 19:00–23:00“ nebo „ke dni čt 5. 11.“ */
  kCemu: string | null
  zpet: { href: string; text: string }
  nahled: NahledDocx | null
  /** Proč náhled není (věta pro člověka). */
  chyba: string | null
}) {
  const prazdny = nahled !== null && !nahled.bloky.some((b) => b.druh === 'tabulka' || b.useky.length > 0)
  return (
    <>
      <Nadpis
        oci="Provoz · Rezervace a akce · Dokument"
        popis={[
          'Dokument Word',
          velikostText(priloha.velikost),
          `nahráno ${datumACasSRokemVPasmu(priloha.nahrano, zona)}`,
          kCemu,
        ]
          .filter(Boolean)
          .join(' · ')}
        vpravo={
          <a href={`/api/rezervace/soubor/${priloha.id}`} className="ft-tl ft-tl-hlavni">
            Stáhnout originál
          </a>
        }
      >
        {priloha.nazev}
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="kalendar" />
        <p className="ds-dokument-pozn">
          <Link href={zpet.href}>
            <Ikona klic="sipkaVlevo" /> {zpet.text}
          </Link>
          <span>
            Náhled ukazuje text a tabulky. Obrázky, záhlaví a přesné rozvržení má jen originál — tlačítko Stáhnout originál ho
            uloží do Stažených souborů, otevře se ve Wordu.
          </span>
        </p>
        {chyba ? (
          <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
            {chyba} Originál jde stáhnout tlačítkem Stáhnout originál.
          </p>
        ) : nahled ? (
          <>
            {nahled.obrazku > 0 || nahled.zkraceno ? (
              <p className="ds-rez-zdroj" role="status">
                {[
                  nahled.obrazku > 0 ? `V dokumentu ${pocet(nahled.obrazku, 'je obrázek', 'jsou obrázky', 'je obrázků')} — v náhledu je po nich jen značka.` : null,
                  nahled.zkraceno ? 'Dokument je dlouhý, náhled ukazuje jen začátek.' : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            ) : null}
            <article className="ds-plocha ds-dokument" aria-label={`Obsah dokumentu ${priloha.nazev}`}>
              {prazdny ? <p className="ds-dokument-nic">V dokumentu není žádný text.</p> : <ObsahDokumentu bloky={nahled.bloky} />}
            </article>
          </>
        ) : null}
      </div>
    </>
  )
}
