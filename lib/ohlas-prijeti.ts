import 'server-only'

import { odeslatEmail } from '@/lib/email'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * E-mail o tom, že někdo přijal pozvánku.
 *
 * Zadání docs/upozorneni-na-prijeti-zadani.md, oddíl 4: zvoneček
 * vždycky, e-mail hned. Push do mobilu NE — a dokud nechodí, nepíše se
 * o něm ani v rozhraní.
 *
 * ---------------------------------------------------------------------
 * PROČ TO POSÍLÁ TEN, KDO PŘIJAL
 *
 * Přijetí se děje v sezení pozvaného. Ten `people.manage` nemá a mít
 * nemá, takže adresy vydává průzor `komu_ohlasit_prijeti` — a jen tomu,
 * kdo do té firmy právě vstoupil, pět minut od přijetí.
 *
 * Adresy se nikdy nevracejí do prohlížeče. Bere si je server, aby měl
 * kam poslat.
 *
 * ---------------------------------------------------------------------
 * NIC TU NESMÍ SPADNOUT
 *
 * Členství už v tu chvíli existuje. Kdyby se pošta rozbila, přijetí
 * platí dál a zvoneček zůstává — ten píše spoušť v databázi a na tomhle
 * kódu nezávisí. Proto se odsud nevyhazuje nic; vrací se jen, kolik
 * e-mailů odešlo, ať to má volající kam zapsat.
 */

/** Předmět bez jmen: čte ho i ten, kdo ho nemá otevřít. */
const PREDMET = 'Foodtab — někdo přijal pozvánku'

export async function ohlasPrijetiPozvanky(
  tenantId: string,
): Promise<{ odeslano: number; selhalo: number }> {
  let odeslano = 0
  let selhalo = 0

  try {
    const supabase = await getServerSupabase()
    const { data, error } = await supabase.rpc('komu_ohlasit_prijeti', {
      p_tenant: tenantId,
    })

    // Nenasazená migrace 20260902070000 znamená, že funkce není. Zvoneček
    // ani přijetí to netrápí.
    if (error) return { odeslano: 0, selhalo: 0 }

    const prijemci = (data ?? []) as {
      adresa: string
      jmeno: string
      firma: string
      kdo_prijal: string
      ceka: boolean
    }[]

    for (const p of prijemci) {
      const poslano = await odeslatEmail({
        komu: p.adresa,
        predmet: PREDMET,
        text: telo(p),
        html: html(p),
      })
      if (poslano.stav === 'odeslano') odeslano++
      else selhalo++
    }
  } catch {
    // Viz hlavička: přijetí pozvánky se kvůli poště pokazit nesmí.
    return { odeslano, selhalo: selhalo + 1 }
  }

  return { odeslano, selhalo }
}

/**
 * Dvě různé situace, dva různé texty.
 *
 * „Čeká na oprávnění“ je úkol a je z něj poznat, co se stane, když se
 * neudělá nic. „Má oprávnění“ je informace. Nesmí vypadat stejně.
 */
function telo(p: { jmeno: string; firma: string; kdo_prijal: string; ceka: boolean }): string {
  return p.ceka
    ? `${p.kdo_prijal} přijal pozvánku do firmy ${p.firma} a čeká na oprávnění.\n\n` +
        'Dokud mu je nepřidělíte, v aplikaci neuvidí nic než své údaje.\n'
    : `${p.kdo_prijal} přijal pozvánku do firmy ${p.firma} a oprávnění už má.\n`
}

function html(p: { jmeno: string; firma: string; kdo_prijal: string; ceka: boolean }): string {
  const kdo = escapovat(p.kdo_prijal)
  const firma = escapovat(p.firma)

  return p.ceka
    ? `<p><strong>${kdo}</strong> přijal pozvánku do firmy ${firma} a <strong>čeká na oprávnění</strong>.</p>` +
        '<p>Dokud mu je nepřidělíte, v aplikaci neuvidí nic než své údaje.</p>'
    : `<p><strong>${kdo}</strong> přijal pozvánku do firmy ${firma} a oprávnění už má.</p>`
}

function escapovat(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
