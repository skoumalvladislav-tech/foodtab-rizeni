'use client'

/**
 * Tlačítko Smazat u řádku zaměstnance.
 *
 * Jediné místo v aplikaci s vzhledem .ft-tl-nebezpecne — mazání je
 * jediná akce, která se rovná ztrátě. Běžná akce červenou nedostane.
 *
 * Klientské je jen kvůli potvrzovacímu dotazu. Vlastní mazání dělá
 * serverová akce, která si oprávnění ověří znovu — kdyby si někdo dotaz
 * obešel, nic tím neotevře. Bez JavaScriptu formulář odejde rovnou,
 * což je u soft-delete přijatelné: řádek zůstává v databázi.
 */
export default function SmazatZamestnance({
  akce,
  id,
  rozsah,
  jmeno,
}: {
  /** Serverová akce z ./akce.ts. Předává se jako vlastnost. */
  akce: (formData: FormData) => Promise<void>
  id: string
  rozsah: string
  /** Do dotazu, ať je vidět, o koho jde. */
  jmeno: string
}) {
  return (
    <form
      action={akce}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        const ptame = `Smazat ${jmeno}? Ze seznamu zmizí, odpracované směny zůstanou.`
        if (!window.confirm(ptame)) e.preventDefault()
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rozsah" value={rozsah} />
      <button type="submit" className="ft-tl ft-tl-nebezpecne ft-tl-male">
        Smazat
      </button>
    </form>
  )
}
