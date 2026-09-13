import 'server-only'

/**
 * Předání příspěvku n8n ke zveřejnění.
 *
 * ---------------------------------------------------------------------
 * PROČ FOODTAB NEMLUVÍ NA INSTAGRAM SÁM
 *
 * Protože už s ním mluví n8n. Přístup k účtu Černé Perly tam leží od
 * srpna a workflow „Černá Perla — denní obsah na sítě" podle něj
 * publikuje. Kdyby si Foodtab zavedl vlastní přístup, byl by týž token
 * na dvou místech, dvakrát by se obnovoval a při odvolání by se na
 * jedno z nich zapomnělo.
 *
 * Rozhodnutí je v `docs/marketing-je-modul.md`: „API zůstává jen tam,
 * kde opravdu vede ven — n8n a poskytovatelé."
 *
 * Foodtab tedy rozhoduje CO a KDY se zveřejní (verze, schválení,
 * fronta) a n8n to POŠLE. Jedno místo s tokenem, jedno místo, které
 * mluví s Instagramem.
 *
 * ---------------------------------------------------------------------
 * IDEMPOTENČNÍ KLÍČ NENÍ OZDOBA
 *
 * Odesílá se `idempotencni_klic` a n8n si podle něj MUSÍ pamatovat, co
 * už poslalo. Bez toho stačí, aby se odpověď ztratila cestou zpátky:
 * Foodtab to vezme jako neúspěch, za pět minut to zkusí znovu — a na
 * Instagramu jsou dva stejné příspěvky. Zpátky se to vzít nedá.
 *
 * Zámek ve frontě (`for update skip locked`) tuhle díru nezavře. Ten
 * hlídá dva BĚHY Foodtabu, ne ztracenou odpověď od n8n.
 *
 * ---------------------------------------------------------------------
 * ODKAZY NA FOTKY JSOU DOČASNÉ KLÍČE
 *
 * Posílají se podepsané odkazy do úložiště. Kdo takový odkaz má,
 * na tu fotku dosáhne bez přihlášení, dokud nevyprší — Instagram si ji
 * podle něj stáhne. Do logu proto celé tělo požadavku nepatří.
 */

/** Adresa webhooku v n8n. Bez ní se nikam nic neposílá. */
const PROMENNA_URL = 'N8N_MARKETING_URL'

/** Sdílené tajemství. Chodí v hlavičce, nikdy v adrese — adresy končí v logu. */
const PROMENNA_TAJEMSTVI = 'N8N_MARKETING_TAJEMSTVI'

/**
 * Kolik čekat na odpověď.
 *
 * Instagram se publikuje na dvakrát (nahrát kontejner, pak zveřejnit)
 * a mezi tím se čeká, až obrázek zpracuje. Půl minuty je se zásobou;
 * co trvá dýl, je zaseknuté a má se zkusit znovu, ne blokovat frontu.
 */
const CEKANI_MS = 30_000

export type Obrazek = { url: string; alt: string }

export type Pozadavek = {
  /*
    FIRMA A POBOČKA JDOU S KAŽDÝM POŽADAVKEM.

    Dnes je firma jedna a webhook taky jeden, takže by se to zdálo
    zbytečné. Jenže jeden webhook pro všechny firmy znamená, že
    příspěvek druhé restaurace odejde na Instagram té první — a to
    není chyba, které by si někdo všiml v logu. Všimne si jí host,
    kterému se v profilu objeví cizí menu.

    n8n proto musí podle těchhle dvou údajů vybrat, na který účet
    posílá, a neznámou firmu ODMÍTNOUT. Posílat je a nekoukat na ně
    je horší než je neposílat: vypadá to, že se to hlídá.
  */
  tenantId: string
  branchId: string
  ulohaId: string
  idempotencniKlic: string
  kanal: string
  format: string
  popisek: string
  obrazky: Obrazek[]
}

export type Odpoved =
  | { stav: 'zverejneno'; externiId: string | null; odkaz: string | null; odpoved: unknown }
  | { stav: 'chyba'; duvod: string }

/** Je předání do n8n vůbec nastavené? Fronta se tím ptá, než to zkusí. */
export function n8nJeNastaveny(): boolean {
  return Boolean(process.env[PROMENNA_URL] && process.env[PROMENNA_TAJEMSTVI])
}

export async function predatN8n(pozadavek: Pozadavek): Promise<Odpoved> {
  const url = process.env[PROMENNA_URL]
  const tajemstvi = process.env[PROMENNA_TAJEMSTVI]

  if (!url || !tajemstvi) {
    return {
      stav: 'chyba',
      duvod:
        `Zveřejňování není nastavené — chybí ${PROMENNA_URL} nebo ${PROMENNA_TAJEMSTVI}. ` +
        'Do té doby použijte ruční režim.',
    }
  }

  let odpoved: Response
  try {
    odpoved = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Vlastní hlavička, ne `Authorization`: v n8n se dá týž
        // přihlašovací údaj omylem připnout k jinému uzlu mířícímu
        // jinam, a `Authorization` k tomu přímo svádí.
        'x-foodtab-tajemstvi': tajemstvi,
      },
      body: JSON.stringify({
        tenant_id: pozadavek.tenantId,
        branch_id: pozadavek.branchId,
        uloha_id: pozadavek.ulohaId,
        idempotencni_klic: pozadavek.idempotencniKlic,
        kanal: pozadavek.kanal,
        format: pozadavek.format,
        popisek: pozadavek.popisek,
        obrazky: pozadavek.obrazky,
      }),
      // Zaseknuté n8n nesmí zablokovat celou frontu.
      signal: AbortSignal.timeout(CEKANI_MS),
    })
  } catch (e) {
    /*
      Sem spadne i vypršení času. A to je ta ošemetná chyba: n8n mohlo
      stihnout zveřejnit a jen se nestihlo ozvat. Proto se to hlásí
      jako neúspěch (fronta to zkusí znovu) a proti dvojímu příspěvku
      chrání idempotenční klíč na straně n8n, ne tahle hláška.
    */
    const duvod = e instanceof Error && e.name === 'TimeoutError'
      ? 'n8n se do půl minuty neozvalo. Zkusí se to znovu.'
      : `n8n se nepodařilo zavolat: ${e instanceof Error ? e.message : 'neznámá chyba'}`
    return { stav: 'chyba', duvod }
  }

  if (!odpoved.ok) {
    // Tělo se čte, ale ořezané: hlášky od cizí služby bývají dlouhé
    // a jde do sloupce, který si přečte člověk na obrazovce.
    const telo = (await odpoved.text().catch(() => '')).slice(0, 300)
    return { stav: 'chyba', duvod: `n8n odpovědělo ${odpoved.status}. ${telo}`.trim() }
  }

  let telo: unknown
  try {
    telo = await odpoved.json()
  } catch {
    return { stav: 'chyba', duvod: 'n8n odpovědělo něčím, co není JSON.' }
  }

  return precistOdpoved(telo)
}

/**
 * Přečtení odpovědi.
 *
 * Cokoli, čemu nerozumíme, je CHYBA — nikdy „asi to vyšlo". Zapsat
 * zveřejnění, které se nestalo, je horší než zkusit to znovu: příspěvek
 * by zůstal nezveřejněný a v přehledu by svítil jako hotový.
 */
export function precistOdpoved(telo: unknown): Odpoved {
  if (!telo || typeof telo !== 'object') {
    return { stav: 'chyba', duvod: 'n8n neposlalo odpověď, které by šlo rozumět.' }
  }

  const o = telo as Record<string, unknown>

  if (o.stav === 'zverejneno') {
    return {
      stav: 'zverejneno',
      externiId: typeof o.externi_id === 'string' ? o.externi_id : null,
      odkaz: typeof o.odkaz === 'string' ? o.odkaz : null,
      odpoved: telo,
    }
  }

  if (o.stav === 'chyba') {
    const duvod = typeof o.duvod === 'string' && o.duvod.trim() !== ''
      ? o.duvod.slice(0, 300)
      : 'n8n zveřejnění odmítlo a neřeklo proč.'
    return { stav: 'chyba', duvod }
  }

  return { stav: 'chyba', duvod: `n8n poslalo neznámý stav: ${String(o.stav).slice(0, 60)}` }
}
