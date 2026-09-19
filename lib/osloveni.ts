/**
 * Oslovení křestním jménem v 5. pádu: „Dobré odpoledne, Vladislave“.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NENÍ ÚPLNÉ
 *
 * Český vokativ má výjimek na knihu a jméno z databáze může být cokoli
 * — Vietnamec, Ukrajinka, přezdívka. Špatně skloněné jméno je horší než
 * jméno v 1. pádu, proto se skloňuje JEN tam, kde je pravidlo spolehlivé,
 * a všude jinde se vrací jméno tak, jak je.
 *
 * Co se skloňuje:
 *   -a               → -o      Hana → Hano, Honza → Honzo
 *   -ek              → -ku     Marek → Marku
 *   -něk -děk -těk   → -ňku …  Zdeněk → Zdeňku, Luděk → Luďku
 *   souhláska + -r   → -ře     Petr → Petře
 *   -b -d -f -m -n -p -s -t -v -z, samohláska + -r
 *                    → +e      Vladislav → Vladislave, Jan → Jane
 *   -l (mimo -el)    → +e      Michal → Michale
 *   -š -ž -č -ř -c -j → +i     Tomáš → Tomáši, Ondřej → Ondřeji
 *   -k -g -h -ch     → +u      Erik → Eriku
 *   Karel, Pavel     → Karle, Pavle (dvě výslovné výjimky)
 *
 * Co zůstává: jména na -e, -ie, -í, -ý, -y, -i, -o, -u, -ě (Lucie,
 * Jiří, Marie) — jsou v 5. pádu stejná — a jména na -el (Daniel, Michael:
 * Danieli/Daniele, pravidlo není jednoznačné), víceslovná a jména
 * s pomlčkou.
 * ------------------------------------------------------------------ */

const SAMOHLASKY = 'aáeéěiíoóuúůyý'
// Zdeněk → Zdeňku, Luděk → Luďku: souhláska před „-ěk“ se změkčí.
const MEKKA_PRED_EK: Record<string, string> = { n: 'ň', d: 'ď', t: 'ť' }
const VYJIMKY: Record<string, string> = {
  karel: 'Karle',
  pavel: 'Pavle',
}

export function osloveni(krestni: string | null | undefined): string {
  const jmeno = (krestni ?? '').trim()
  if (jmeno === '') return ''

  // Jen jedno slovo z písmen. Pomlčky, tečky, čísla → beze změny.
  if (!/^\p{L}+$/u.test(jmeno)) return jmeno

  const male = jmeno.toLowerCase()
  const vyjimka = VYJIMKY[male]
  if (vyjimka) return vyjimka

  const posledni = male.slice(-1)
  const predposledni = male.slice(-2, -1)

  if (posledni === 'a') return jmeno.slice(0, -1) + 'o'

  if (male.endsWith('ěk')) {
    const zmekceni = MEKKA_PRED_EK[male.slice(-3, -2)]
    return zmekceni ? jmeno.slice(0, -3) + zmekceni + 'ku' : jmeno
  }
  if (male.endsWith('ek') && male.length > 2) return jmeno.slice(0, -2) + 'ku'

  if (male.endsWith('ch')) return jmeno + 'u'
  if ('kgh'.includes(posledni)) return jmeno + 'u'

  if (posledni === 'r') {
    return SAMOHLASKY.includes(predposledni) ? jmeno + 'e' : jmeno.slice(0, -1) + 'ře'
  }

  if (male.endsWith('el')) return jmeno
  if ('bdfmnpstvzl'.includes(posledni)) return jmeno + 'e'

  if ('šžčřcj'.includes(posledni)) return jmeno + 'i'

  return jmeno
}
