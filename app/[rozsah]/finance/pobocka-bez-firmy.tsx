import Link from 'next/link'

import Sdeleni from '@/app/sdeleni'

/**
 * Obrazovka Financí na pobočce pro toho, kdo má finanční přehled jen na
 * pobočce, ne za celou firmu (`zkusPristupFinanci` → `pobocka_bez_firmy`,
 * `pobockaBezPrehleduFirmy`; důvod v lib/finance-pristup.ts).
 *
 * Vykresluje ji KAŽDÁ stránka sama, prvním řádkem po vstupní kontrole —
 * ne rám Financí (N23: sdílený layout se při přechodu přes menu znovu
 * nevykreslí a stránku stejně nezastaví).
 *
 * Jiné platby pobočky tenhle člověk otevřít smí (vlastní vstup
 * `zkusPristupJinymPlatbam`, záznamy jsou řádky pobočky) — odkaz na ně.
 */
export default function SdeleniPobockyBezFirmy({ rozsah }: { rozsah: string }) {
  return (
    <Sdeleni
      nadpis="Finance pobočky zatím jen s přehledem celé firmy"
      pata={
        <Link href={`/${rozsah}/finance/trzby/jine-platby`} className="ft-tl ft-tl-vedlejsi">
          Jiné platby této pobočky
        </Link>
      }
    >
      Finance jednotlivé pobočky zatím vidí jen ten, kdo má finanční přehled za celou firmu.
      Část údajů (banka, kontakty, párování plateb) se po pobočkách zatím oddělit nedá.
    </Sdeleni>
  )
}
