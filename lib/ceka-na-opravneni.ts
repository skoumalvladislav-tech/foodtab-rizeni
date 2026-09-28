/**
 * Kdo čeká na oprávnění — věty a odkazy.
 *
 * Hlášení majitele 25. 9. 2026: okno „N lidí čeká na oprávnění" psalo
 * „Nový člověk" a tlačítko vedlo na `/nastaveni/lide?clovek=<id účtu>`.
 * Obrazovka Lidé parametr `clovek` nikdy neznala, takže se otevřel holý
 * seznam a majitel nevěděl, komu co přidělit. Lidé rozbalí panel
 * oprávnění jen podle ZAMĚSTNANCE: `?opravneni=<id záznamu>#opravneni`.
 *
 * Tady je to vytažené z komponent, aby na to šlo sáhnout testem
 * (scripts/ceka-na-opravneni.test.mjs) a aby okno při přihlášení,
 * karta v Lidech i upozornění skládaly odkaz stejně.
 *
 * Data chodí z `public.cekaji_na_opravneni` (20260925150000). Nová pole
 * jsou nepovinná: než se migrace nasadí, vrací funkce jen `user_id`,
 * `jmeno` a `od` — okno pak ukáže jméno a odkaz na Lidi, nic nespadne.
 */

export type DuvodCekani =
  | 'bez_zaznamu'
  | 'zaznam_smazany'
  | 'bez_zarazeni'
  | 'zarazeni_bez_prav'

export type Cekajici = {
  user_id: string
  jmeno: string
  /** E-mail účtu (telefon, když e-mail nemá). */
  kontakt?: string | null
  /** Jen ŽIVÝ záznam v Lidech. Na smazaný se oprávnění nepřidělují. */
  employee_id?: string | null
  duvod?: DuvodCekani | null
  zarazeni?: string | null
  zarazeni_id?: string | null
}

export type Odkaz = { href: string; popisek: string }

/** Panel oprávnění u člověka v Lidech. Kotva, jinak zůstane mimo obrazovku. */
export function odkazNaOpravneni(rozsah: string, zamestnanec: string): string {
  return `/${rozsah}/nastaveni/lide?opravneni=${encodeURIComponent(zamestnanec)}#opravneni`
}

/**
 * Formulář pozvánky v Lidech, rovnou rozbalený. Kotva, jinak zůstane
 * pod tabulkou mimo obrazovku.
 */
export function odkazNaPozvanku(rozsah: string): string {
  return `/${rozsah}/nastaveni/lide?pozvat=1#pozvanka`
}

/**
 * Kam z upozornění „přijal pozvánku a čeká". Se záznamem rovnou na jeho
 * oprávnění; bez záznamu na kartu čekajících v Lidech, kde jde účet
 * odebrat nebo se dočíst, co s ním.
 */
export function odkazNaPrijatouPozvanku(rozsah: string, zamestnanec: string | null): string {
  return zamestnanec ? odkazNaOpravneni(rozsah, zamestnanec) : `/${rozsah}/nastaveni/lide#cekaji`
}

/** Proč čeká — jedna věta pod jménem. */
export function popisDuvodu(c: Cekajici): string | null {
  switch (c.duvod) {
    case 'bez_zaznamu':
      return 'Účet není propojený s nikým v Lidech.'
    case 'zaznam_smazany':
      return 'Záznam v Lidech je smazaný.'
    case 'bez_zarazeni':
      return 'V Lidech nemá zařazení ani žádné oprávnění.'
    case 'zarazeni_bez_prav':
      return c.zarazeni
        ? `Zařazení ${c.zarazeni} zatím nemá žádná oprávnění.`
        : 'Jeho zařazení zatím nemá žádná oprávnění.'
    default:
      return null
  }
}

/**
 * Co s ním jde udělat.
 *
 *  * Zařazení bez práv: nejdřív zařazení — práva se dají jemu i všem se
 *    stejným zařazením. Oprávnění u člověka (jiné zařazení, výjimka)
 *    zůstává vedle.
 *  * Záznam bez zařazení: oprávnění u člověka.
 *  * Bez záznamu nebo se smazaným: oprávnění není komu přidělit.
 *    Nabídne se „Odebrat z firmy" (s potvrzením). U „bez záznamu" navíc
 *    odkaz na formulář pozvánky v Lidech (rozbalený) a věta, jak účet
 *    s člověkem propojit — pozvánkou na tuhle adresu, vybraného
 *    člověka. Když ten už účet má, je to PŘESUN a vystaví ho jen
 *    majitel (20260925150000, hlavička B). Kontrola 28. 9. 2026: věta
 *    dřív radila „pozvánku z jeho řádku v Lidech", jenže v řádku žádná
 *    není — formulář je sbalený pod tabulkou.
 */
export function akceCekajiciho(
  rozsah: string,
  c: Cekajici,
): { hlavni: Odkaz | null; vedlejsi: Odkaz | null; odebrat: boolean; napoveda: string | null } {
  if (c.employee_id) {
    const opravneni = { href: odkazNaOpravneni(rozsah, c.employee_id), popisek: 'Přidělit oprávnění' }
    if (c.duvod === 'zarazeni_bez_prav' && c.zarazeni_id) {
      return {
        hlavni: {
          href: `/${rozsah}/nastaveni/role#zarazeni-${encodeURIComponent(c.zarazeni_id)}`,
          popisek: c.zarazeni ? `Nastavit zařazení ${c.zarazeni}` : 'Nastavit zařazení',
        },
        vedlejsi: { ...opravneni, popisek: 'Oprávnění člověka' },
        odebrat: false,
        napoveda: null,
      }
    }
    return { hlavni: opravneni, vedlejsi: null, odebrat: false, napoveda: null }
  }

  if (c.duvod === 'bez_zaznamu') {
    return {
      hlavni: null,
      vedlejsi: { href: odkazNaPozvanku(rozsah), popisek: 'Pozvat z Lidí' },
      odebrat: true,
      napoveda:
        'Je to někdo z Lidí? Vystavte mu pozvánku na tuhle adresu (Pozvat z Lidí → vyberte ho) — po přijetí se účet s ním propojí. Když už má jiný účet, pozvánka přístup přesune a vystaví ji jen majitel. Jinak účet z firmy odeberte.',
    }
  }

  if (c.duvod === 'zaznam_smazany') {
    return { hlavni: null, vedlejsi: null, odebrat: true, napoveda: null }
  }

  // Starší databáze bez důvodu: aspoň seznam lidí.
  return {
    hlavni: { href: `/${rozsah}/nastaveni/lide`, popisek: 'Otevřít Lidi' },
    vedlejsi: null,
    odebrat: false,
    napoveda: null,
  }
}
