'use client'

import { useParams } from 'next/navigation'

import ErrorState from '@/components/ui/ErrorState'

/**
 * Náhled dokumentu se nepodařilo ukázat.
 *
 * Word se z detailu rezervace otevírá jen přes náhled — kdyby stránka
 * spadla (cizí soubor, se kterým čtečka nepočítala), nešel by originál
 * z aplikace vůbec stáhnout. Proto tady tlačítko na originál vždycky
 * je. Odkaz vede na /api/rezervace/soubor/[id], který si přístup ověří
 * sám; id z adresy se jen zakóduje.
 *
 * Kód chyby (`digest`) se ukazuje drobně — kdo se ozve podpoře, má co
 * říct; technický text zprávy se člověku neukazuje.
 */
export default function ChybaDokumentu({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { id } = useParams<{ id: string }>()
  return (
    <ErrorState
      nadpis="Náhled dokumentu se nepodařilo ukázat."
      akce={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
          <a href={`/api/rezervace/soubor/${encodeURIComponent(id ?? '')}`} className="ft-tl ft-tl-hlavni">
            Stáhnout originál
          </a>
          <button type="button" className="ft-tl" onClick={reset}>
            Zkusit znovu
          </button>
        </div>
      }
    >
      Originál jde stáhnout tlačítkem a otevřít ve Wordu.
      {error.digest ? (
        <span style={{ display: 'block', marginTop: '8px', fontSize: '12px', color: 'var(--faint)' }}>Kód: {error.digest}</span>
      ) : null}
    </ErrorState>
  )
}
