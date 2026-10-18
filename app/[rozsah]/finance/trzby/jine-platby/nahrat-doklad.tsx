'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import {
  KBELIK_JINYCH_PLATEB,
  cestaSouboru,
  jeTypSouboru,
  noveId,
  ocistitNazev,
  typSouboru,
  zkontrolovatPoZmenseni,
  zkontrolovatVyber,
  zmensitDoklad,
} from '@/lib/jine-platby-soubory'
import { MAX_SOUBORU_NA_ZAZNAM } from '@/lib/jine-platby-typy'
import { getBrowserSupabase } from '@/lib/supabase/client'
import Ikona from '../../../ikona'
import { pripojitSoubor } from './akce-soubory'

/**
 * Nahrání dokladu k záznamu Jiných plateb — „Vyfotit" (fotoaparát
 * telefonu) a „Vybrat fotku nebo PDF". Používá ji karta záznamu.
 *
 * SOUBOR JDE Z PROHLÍŽEČE PŘÍMO DO ÚLOŽIŠTĚ pod přihlášeným člověkem
 * (serverová akce má strop 1 MB). O tom, kdo smí kam nahrát, rozhoduje
 * politika kbelíku `jine-platby`, ne tahle komponenta. Pak serverová akce
 * `pripojitSoubor` soubor stáhne, pozná typ z obsahu, spočítá otisk
 * a připojí ho přes `jine_platby_pripojit_soubor`.
 *
 * Fotka se zmenšuje JEN, když musí (větší než strop fotky pro AI
 * `MAX_BAJTU_OBRAZKU_PRO_AI`, 5 MB, nebo HEIC), a vlastní funkcí pro
 * doklady (delší strana 4000 px a JPEG 0,9, pak 0,8, nakonec 3000 px) —
 * ne `lib/obrazky.ts`, který by drobné písmo účtenky rozmazal
 * (lib/jine-platby-soubory.ts). Fotka, která se pod strop nevejde ani
 * tak, se nenahraje a řekne se proč (`zkontrolovatPoZmenseni`) — AI by
 * ji stejně odmítla.
 *
 * ČESTNĚ: bez spojení nahrání selže nahlas, do fronty se nic neukládá.
 * Soubor, který se nahrál a nepřipojil (zavřená karta uprostřed), zůstane
 * v úložišti jako sirotek bez řádku — nikde se neukáže.
 */
export default function NahratDoklad({
  rozsah,
  tenantId,
  branchId,
  zaznamId,
  uzMa,
  smi,
}: {
  rozsah: string
  tenantId: string
  branchId: string
  zaznamId: string
  /** Kolik souborů už záznam má. */
  uzMa: number
  /** Smí nahrávat (`jine_platby.zadat` nebo `.upravit` na pobočce záznamu, záznam není zrušený). */
  smi: boolean
}) {
  const router = useRouter()
  const foto = useRef<HTMLInputElement>(null)
  const vyber = useRef<HTMLInputElement>(null)
  const bezi = useRef(false)
  const [prubeh, setPrubeh] = useState<string | null>(null)
  const [hotovo, setHotovo] = useState<string | null>(null)
  const [chyby, setChyby] = useState<{ text: string; odkaz: string | null }[]>([])

  if (!smi) return null

  const plno = uzMa >= MAX_SOUBORU_NA_ZAZNAM
  const zakladDetailu = `/${rozsah}/finance/trzby/jine-platby`

  async function nahrat(seznam: FileList | null) {
    if (!seznam || seznam.length === 0 || bezi.current) return
    bezi.current = true
    setHotovo(null)
    setChyby([])
    const nove: { text: string; odkaz: string | null }[] = []
    let pripojeno = 0

    try {
      const soubory = Array.from(seznam)
      const kontrola = zkontrolovatVyber(
        soubory.map((s) => ({ name: s.name, type: s.type, size: s.size })),
        uzMa,
      )
      for (const c of kontrola.chyby) nove.push({ text: c, odkaz: null })
      const supabase = getBrowserSupabase()

      for (const [poradi, polozka] of kontrola.polozky.entries()) {
        const s = soubory[polozka.index]
        const nazev = ocistitNazev(s.name)

        let blob: Blob = s
        let mime = typSouboru(s)
        if (polozka.akce === 'zmensit') {
          setPrubeh(`Zmenšuji ${poradi + 1} z ${kontrola.polozky.length}: ${nazev}`)
          const zmenseny = await zmensitDoklad(s)
          if (zmenseny) {
            blob = zmenseny
            mime = 'image/jpeg'
          }
        }
        // Fotka nad stropem pro AI (nezmenšená, nebo ani po zmenšení) se odmítne s vysvětlením.
        const problem = zkontrolovatPoZmenseni(s.name, mime, blob.size)
        if (problem || !jeTypSouboru(mime)) {
          nove.push({ text: problem ?? `„${nazev}“: tenhle typ souboru nejde nahrát.`, odkaz: null })
          continue
        }
        setPrubeh(`Nahrávám ${poradi + 1} z ${kontrola.polozky.length}: ${nazev}`)

        const cesta = cestaSouboru(tenantId, branchId, zaznamId, noveId(), mime)
        const { error } = await supabase.storage.from(KBELIK_JINYCH_PLATEB).upload(cesta, blob, {
          contentType: mime,
          upsert: false,
        })
        if (error) {
          nove.push({ text: `„${nazev}“ se nepodařilo nahrát: ${error.message}`, odkaz: null })
          continue
        }

        const vysledek = await pripojitSoubor(rozsah, zaznamId, cesta)
        if (vysledek.ok) {
          pripojeno += 1
        } else {
          nove.push({
            text: `„${nazev}“: ${vysledek.chyba}`,
            odkaz: vysledek.jinyZaznam ? `${zakladDetailu}/${vysledek.jinyZaznam}` : null,
          })
        }
      }
    } catch {
      nove.push({ text: 'Není spojení — zkuste to znovu, až se vrátí.', odkaz: null })
    } finally {
      bezi.current = false
      setPrubeh(null)
      setChyby(nove)
      if (pripojeno > 0) setHotovo(pripojeno === 1 ? 'Doklad je připojený.' : `Připojeno ${pripojeno} dokladů.`)
      if (foto.current) foto.current.value = ''
      if (vyber.current) vyber.current.value = ''
      if (pripojeno > 0) router.refresh()
    }
  }

  const nahrava = prubeh !== null

  return (
    <div style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
      <input
        ref={foto}
        type="file"
        hidden
        accept="image/*"
        capture="environment"
        onChange={(e) => void nahrat(e.target.files)}
      />
      <input
        ref={vyber}
        type="file"
        hidden
        multiple
        accept="image/*,application/pdf"
        onChange={(e) => void nahrat(e.target.files)}
      />
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button type="button" className="ft-tl ft-tl-hlavni" onClick={() => foto.current?.click()} disabled={nahrava || plno}>
          <Ikona klic="fotka" />
          Vyfotit
        </button>
        <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={() => vyber.current?.click()} disabled={nahrava || plno}>
          <Ikona klic="sponka" />
          Vybrat fotku nebo PDF
        </button>
      </div>

      <p role="status" aria-live="polite" style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)', minHeight: '1.4em' }}>
        {prubeh ?? hotovo ?? (plno ? `Záznam už má ${MAX_SOUBORU_NA_ZAZNAM} souborů, víc připojit nejde.` : '')}
      </p>

      {chyby.length > 0 ? (
        <div role="alert" style={{ display: 'grid', gap: '6px' }}>
          {chyby.map((c, i) => (
            <p key={i} className="hlaska-chyba" style={{ margin: 0 }}>
              <span>
                {c.text}
                {c.odkaz ? (
                  <>
                    {' '}
                    <Link href={c.odkaz} className="ds-plocha-odkaz" style={{ marginLeft: 0, color: 'inherit' }}>
                      Otevřít ten záznam →
                    </Link>
                  </>
                ) : null}
              </span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
