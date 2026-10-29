'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { noveId } from '@/lib/obrazky'
import { KBELIK_REZERVACI, MAX_PRILOH_REZERVACE, cestaPrilohy, zkontrolovatVyber } from '@/lib/rezervace-prilohy'
import { getBrowserSupabase } from '@/lib/supabase/client'

import Ikona from '../ikona'
import { pripojitPrilohu } from './akce'
import { pripravitSoubor } from './priprava-souboru'
import type { CilZapisu } from './prvky'

/**
 * Nahrání dokumentů k rezervaci nebo ke dni (smlouva, menu, plán sálu,
 * fotka dortu…).
 *
 * Stejný postup jako přílohy ke zprávám (vzkazy/[konverzace]/
 * priloha-pridat.tsx): soubor jde z prohlížeče PŘÍMO do úložiště, pod
 * přihlášeným člověkem — serverová akce má strop 1 MB. O tom, kdo smí
 * kam, rozhoduje politika kbelíku `rezervace` (cesta nese firmu
 * a pobočku). Teprve pak serverová akce soubor připojí; databáze ověří,
 * že v úložišti je a má typ a velikost, jaké tvrdíme.
 *
 * Velké fotky se zmenší (delší strana 2000 px, JPEG). Když připojení
 * selže, nahraný soubor se zkusí smazat; když se nepovede ani to,
 * zůstane sirotek, který nikomu neškodí.
 */
export default function NahratPrilohy({
  rozsah,
  cil,
  tenantId,
  branchId,
  uzMa,
}: {
  rozsah: string
  cil: CilZapisu
  tenantId: string
  branchId: string
  uzMa: number
}) {
  const router = useRouter()
  const vstupRef = useRef<HTMLInputElement>(null)
  const bezi = useRef(false)
  const [stav, setStav] = useState<'klid' | 'nahrava'>('klid')
  const [chyby, setChyby] = useState<string[]>([])
  const [hotovo, setHotovo] = useState<string | null>(null)

  async function nahrat(seznam: FileList | null) {
    if (!seznam || seznam.length === 0 || bezi.current) return
    bezi.current = true
    setStav('nahrava')
    setChyby([])
    setHotovo(null)
    const nove: string[] = []
    let pripojeno = 0

    try {
      const soubory = Array.from(seznam)
      const kontrola = zkontrolovatVyber(
        soubory.map((s) => ({ name: s.name, type: s.type, size: s.size })),
        uzMa,
      )
      nove.push(...kontrola.chyby)
      const supabase = getBrowserSupabase()

      for (const i of kontrola.platne) {
        const pripraveny = await pripravitSoubor(soubory[i])
        if (pripraveny.stav === 'chyba') {
          nove.push(pripraveny.duvod)
          continue
        }
        const { blob, mime, nazev } = pripraveny
        const cesta = cestaPrilohy(tenantId, branchId, noveId(), mime)

        const { error } = await supabase.storage.from(KBELIK_REZERVACI).upload(cesta, blob, { contentType: mime, upsert: false })
        if (error) {
          nove.push(`„${nazev}“ se nepodařilo nahrát: ${error.message}`)
          continue
        }

        const vysledek = await pripojitPrilohu({
          rozsah,
          rezervace: 'rezervace' in cil ? cil.rezervace : null,
          den: 'den' in cil ? cil.den : null,
          pobocka: 'pobocka' in cil ? cil.pobocka : null,
          cesta,
          nazev,
          mime,
          velikost: blob.size,
        })
        if (!vysledek.ok) {
          nove.push(`„${nazev}“: ${vysledek.chyba}`)
          try {
            await supabase.storage.from(KBELIK_REZERVACI).remove([cesta])
          } catch {
            /* sirotek nikomu neškodí */
          }
          continue
        }
        pripojeno += 1
      }
    } catch {
      nove.push('Není spojení — zkuste to znovu, až se vrátí.')
    } finally {
      bezi.current = false
      setStav('klid')
      setChyby(nove)
      if (pripojeno > 0) {
        setHotovo(pripojeno === 1 ? 'Příloha je přidaná.' : `Přidáno příloh: ${pripojeno}.`)
        router.refresh()
      }
      if (vstupRef.current) vstupRef.current.value = ''
    }
  }

  return (
    <div className="ds-rez-formular">
      <input
        ref={vstupRef}
        type="file"
        hidden
        multiple
        accept="image/*,application/pdf"
        onChange={(e) => void nahrat(e.target.files)}
      />
      <div className="ds-rez-tlacitka" style={{ alignItems: 'center' }}>
        <button
          type="button"
          className="ft-tl ft-tl-vedlejsi"
          onClick={() => vstupRef.current?.click()}
          disabled={stav !== 'klid' || uzMa >= MAX_PRILOH_REZERVACE}
        >
          <Ikona klic="sponka" /> {stav === 'nahrava' ? 'Nahrává se…' : 'Přidat dokument'}
        </button>
        <small style={{ color: 'var(--muted)', fontSize: '12.5px' }}>Fotka nebo PDF, každý soubor do 10 MB.</small>
      </div>
      <div aria-live="polite">
        {hotovo ? <small>{hotovo}</small> : null}
        {chyby.map((c, i) => (
          <p key={i} className="hlaska-chyba" role="alert" style={{ margin: '4px 0 0' }}>
            {c}
          </p>
        ))}
      </div>
    </div>
  )
}
