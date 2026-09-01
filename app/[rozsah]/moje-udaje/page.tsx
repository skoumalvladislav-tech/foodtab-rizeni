import { redirect } from 'next/navigation'

import { getContext, getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { tabulkaNeexistuje, funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../nadpis'
import { nastavitPin, prepnoutSouhlas, ulozitKontakt, vzitNaVedomi } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Moje údaje
 *
 * Odpověď na otázku „co o mně máte“ — bez hrabání v databázi. Zadání
 * docs/osobni-udaje-zadani.md, oddíl 6: vidět, opravit, vyexportovat.
 *
 * Obrazovka není správa lidí. Nepotřebuje žádné oprávnění kromě toho,
 * že člověk do firmy patří, a ukazuje výhradně jeho vlastní údaje.
 *
 * Na téže obrazovce je i informace o zpracování a dobrovolné souhlasy —
 * patří k sobě. Kdo se ptá, co o něm firma má, se ptá i na to, proč to
 * má a co s tím může udělat.
 */

type Kontakt = {
  employee_id: string
  full_name: string
  phone: string | null
  email: string | null
  duvod: string
}

type Informace = {
  id: string
  verze: number
  text_info: string
  je_zastupny: boolean
}

type Druh = {
  key: string
  label: string
  popis: string
  ma_ucinek: boolean
  sort_order: number
}

export default async function MojeUdaje({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; text?: string; ulozeno?: string }>
}) {
  const { rozsah } = await params
  const { chyba, text, ulozeno } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const ctx = await getContext(tenantId)
  if (!ctx) {
    return (
      <Sdeleni nadpis="Firmu se nepodařilo načíst">
        Zkuste to prosím za chvíli znovu.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  /*
    Všechny čtyři dotazy sahají na to, co přináší migrace
    20260901120000. Dokud neproběhne, obrazovka to ŘEKNE — nespadne
    a netváří se, že člověk žádné údaje nemá. Prázdná obrazovka
    „co o vás máme“ je nejhorší možná odpověď.
  */
  const [kontakty, informace, druhy, souhlasy, pin] = await Promise.all([
    supabase.rpc('employee_contacts', { p_tenant: tenantId }),
    supabase
      .from('privacy_notices')
      .select('id, verze, text_info, je_zastupny')
      .eq('tenant_id', tenantId)
      .order('verze', { ascending: false })
      .limit(1),
    supabase
      .from('consent_kinds')
      .select('key, label, popis, ma_ucinek, sort_order')
      .order('sort_order'),
    supabase
      .from('consents')
      .select('kind, granted')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id),
    // Jestli PIN vůbec je. Otisk ani sůl se nevracejí — na to aplikace
    // právo nemá a mít nemá.
    supabase
      .from('employee_pins')
      .select('employee_id, nastaven_kdy')
      .eq('tenant_id', tenantId),
  ])

  const chybiMigrace =
    funkceNeexistuje(kontakty.error) ||
    tabulkaNeexistuje(informace.error) ||
    tabulkaNeexistuje(druhy.error) ||
    tabulkaNeexistuje(souhlasy.error)

  if (chybiMigrace) {
    return (
      <>
        <Nadpis oci="Osobní údaje" popis="Co o vás aplikace vede a co s tím můžete dělat.">
          Moje údaje
        </Nadpis>
        <div style={{ padding: '16px' }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong> Kontaktní
            údaje, informace o zpracování ani souhlasy zatím v databázi
            neexistují — přibudou migrací <code>20260901120000_osobni_udaje</code>.
            Do té doby tu není co ukázat a raději to říkáme, než abychom
            ukázali prázdno.
          </p>
        </div>
      </>
    )
  }

  const muj = ((kontakty.data ?? []) as Kontakt[]).find((k) => k.duvod === 'moje') ?? null
  const info = ((informace.data ?? []) as Informace[])[0] ?? null
  const katalog = (druhy.data ?? []) as Druh[]
  const maPin = ((pin.data ?? []) as { employee_id: string }[]).some(
    (r) => r.employee_id === muj?.employee_id,
  )
  const stav = new Map(
    ((souhlasy.data ?? []) as { kind: string; granted: boolean }[]).map((s) => [
      s.kind,
      s.granted,
    ]),
  )

  return (
    <>
      <Nadpis oci="Osobní údaje" popis="Co o vás aplikace vede a co s tím můžete dělat.">
        Moje údaje
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '760px' }}>
        {chyba ? (
          <p className="hlaska-chyba">
            {popisChyby(chyba)}
            {text ? <span style={{ display: 'block', marginTop: '4px' }}>{text}</span> : null}
          </p>
        ) : null}
        {ulozeno ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--dobre)' }}>
            {popisUlozeni(ulozeno)}
          </p>
        ) : null}

        {/* --- co o mně aplikace ví ------------------------------- */}
        <section style={karta}>
          <h2 style={nadpisKarty}>Co o vás aplikace vede</h2>
          <dl style={seznamUdaju}>
            <dt style={popisek}>Jméno</dt>
            <dd style={hodnota}>{muj?.full_name ?? '—'}</dd>
            <dt style={popisek}>Přihlašovací e-mail</dt>
            <dd style={hodnota}>{user.email ?? '—'}</dd>
            <dt style={popisek}>Firma</dt>
            <dd style={hodnota}>{ctx.tenant.name}</dd>
            <dt style={popisek}>Oprávnění</dt>
            <dd style={hodnota}>
              {ctx.role?.label ?? 'Zatím vám nikdo nepřidělil oprávnění'}
            </dd>
          </dl>
          <p style={{ ...popis, marginBottom: 0 }}>
            Docházka, odpracované hodiny a mzdová sazba se vedou taky — na
            ně se souhlas nežádá, stojí na pracovní smlouvě a na zákonné
            povinnosti. Bez nich by nešla vyplatit mzda.
          </p>
        </section>

        {/* --- oprava kontaktu ------------------------------------ */}
        <section style={karta}>
          <h2 style={nadpisKarty}>Kontakt</h2>
          {muj ? (
            <form action={ulozitKontakt} style={{ display: 'grid', gap: '12px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <label style={poleLabel}>
                <span>Telefon</span>
                <input
                  name="telefon"
                  type="tel"
                  defaultValue={muj.phone ?? ''}
                  placeholder="+420601234567"
                  style={pole}
                />
              </label>
              <label style={poleLabel}>
                <span>E-mail</span>
                <input
                  name="email"
                  type="email"
                  defaultValue={muj.email ?? ''}
                  style={pole}
                />
              </label>
              <p style={popis}>
                Slouží k přihlášení a k pozvánce do aplikace. Prázdné pole
                znamená smazat. Telefon uvidí jen ten, kdo spravuje lidi —
                pokud si níž nepovolíte i kolegy.
              </p>
              <div>
                <button type="submit" className="ft-tl ft-tl-hlavni">
                  Uložit kontakt
                </button>
              </div>
            </form>
          ) : (
            <p style={{ ...popis, marginBottom: 0 }}>
              K vašemu účtu zatím není v téhle firmě zaměstnanecký záznam,
              takže není co opravovat. Řekněte si o to správci lidí.
            </p>
          )}
        </section>

        {/* --- dobrovolné souhlasy -------------------------------- */}
        <section style={karta}>
          <h2 style={nadpisKarty}>Dobrovolné souhlasy</h2>
          <p style={popis}>
            Tohle jsou jediné věci, u kterých se opravdu ptáme. Nic z nich
            není podmínka práce a odmítnutí vás o nic nepřipraví. Odvolat
            se dá kdykoli jedním kliknutím.
          </p>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px' }}>
            {katalog.filter((d) => d.ma_ucinek).map((d) => {
              const udeleno = stav.get(d.key) === true
              return (
                <li key={d.key} style={radekSouhlasu}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: '15px' }}>{d.label}</strong>
                    <span style={{ display: 'block', fontSize: '13px', color: 'var(--muted)', marginTop: '2px' }}>
                      {d.popis}
                    </span>
                  </div>
                  <form action={prepnoutSouhlas}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="druh" value={d.key} />
                    <input type="hidden" name="udelit" value={udeleno ? 'ne' : 'ano'} />
                    <button
                      type="submit"
                      className={udeleno ? 'ft-tl ft-tl-vedlejsi' : 'ft-tl ft-tl-hlavni'}
                    >
                      {udeleno ? 'Odvolat' : 'Povolit'}
                    </button>
                  </form>
                </li>
              )
            })}
          </ul>

          {/*
            Souhlas, po jehož odvolání se nic nestane, je podle zadání
            horší než žádný. Co ještě nemá co zapnout, se proto nenabízí
            — ale je vidět, že na to nezapomněl.
          */}
          {katalog.some((d) => !d.ma_ucinek) ? (
            <p style={{ ...popis, marginBottom: 0 }}>
              Chystá se: {katalog.filter((d) => !d.ma_ucinek).map((d) => d.label).join(', ')}.
              Zatím se na ně neptáme — nebylo by co vypnout, a takový
              souhlas je horší než žádný.
            </p>
          ) : null}
        </section>

        {/* --- PIN ke kiosku -------------------------------------- */}
        <section style={karta}>
          <h2 style={nadpisKarty}>PIN ke kiosku</h2>
          <p style={popis}>
            Pro chvíli, kdy nemáte telefon u sebe. Na tabletu na
            provozovně jím píchnete příchod a odchod — <strong>nic
            jiného</strong>. Do aplikace, k rozpisu ani ke mzdám se jím
            nikdo nedostane, a platí jen na tabletu vaší firmy.
          </p>
          <p style={popis}>
            {maPin
              ? 'PIN máte nastavený. Zadáním nového ten starý přepíšete.'
              : 'PIN zatím nastavený nemáte.'}{' '}
            Přečíst ho nedokáže nikdo, ani majitel — dá se jen zrušit
            a zadat znovu.
          </p>
          <form action={nastavitPin} style={{ display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <label style={poleLabel}>
              <span>{maPin ? 'Nový PIN' : 'PIN'}</span>
              <input
                name="pin"
                inputMode="numeric"
                pattern="[0-9]{4,6}"
                minLength={4}
                maxLength={6}
                required
                autoComplete="off"
                placeholder="4 až 6 číslic"
                style={{ ...pole, letterSpacing: '.3em' }}
              />
            </label>
            <p style={{ ...popis, margin: 0 }}>
              Ne samé stejné číslice a ne řada (1234, 4321) — to se
              uhodne dřív, než dojde káva.
            </p>
            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">
                {maPin ? 'Změnit PIN' : 'Nastavit PIN'}
              </button>
            </div>
          </form>
        </section>

        {/* --- informace o zpracování ----------------------------- */}
        <section style={karta} id="informace">
          <h2 style={nadpisKarty}>Informace o zpracování osobních údajů</h2>
          {info ? (
            <>
              {info.je_zastupny ? (
                <p style={ramecek}>
                  <strong>Tenhle text ještě není hotový.</strong> Je to
                  zástupná kostra, ne právní dokument — skutečné znění musí
                  napsat nebo zkontrolovat právník. Neopírejte se o něj.
                </p>
              ) : null}
              <pre style={textInformace}>{info.text_info}</pre>
              <form action={vzitNaVedomi}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="notice" value={info.id} />
                <p style={popis}>
                  Není to souhlas a nic se jím nepodepisuje — jen se
                  zaznamená, že jste informaci dostali a kterou verzi.
                </p>
                <button type="submit" className="ft-tl ft-tl-hlavni">
                  Beru na vědomí
                </button>
              </form>
            </>
          ) : (
            <p style={{ ...popis, marginBottom: 0 }}>
              Firma zatím informaci o zpracování nemá zveřejněnou.
            </p>
          )}
        </section>

        {/* --- export -------------------------------------------- */}
        <section style={karta}>
          <h2 style={nadpisKarty}>Vydat moje údaje</h2>
          <p style={popis}>
            Stáhne soubor s tím, co o vás aplikace vede. Je to obyčejný
            textový soubor (JSON) — dá se otevřít v poznámkovém bloku
            i poslat dál.
          </p>
          <a href={`/${rozsah}/moje-udaje/export`} className="ft-tl ft-tl-vedlejsi" download>
            Stáhnout soubor
          </a>
        </section>
      </div>
    </>
  )
}

/* --- hlášky -------------------------------------------------------- */

function popisChyby(kod: string): string {
  switch (kod) {
    case 'kontakt':
      return 'Kontakt se nepodařilo uložit.'
    case 'souhlas':
      return 'Souhlas se nepodařilo změnit.'
    case 'vedomi':
      return 'Nepodařilo se zaznamenat, že jste informaci vzali na vědomí.'
    case 'pin':
      return 'PIN se nepodařilo nastavit.'
    default:
      return 'Něco se nepovedlo. Zkuste to prosím znovu.'
  }
}

function popisUlozeni(kod: string): string {
  switch (kod) {
    case 'kontakt':
      return 'Kontakt uložen.'
    case 'souhlas':
      return 'Souhlas udělen. Odvolat ho můžete kdykoli.'
    case 'odvolani':
      return 'Souhlas odvolán. Platí to hned.'
    case 'vedomi':
      return 'Zaznamenáno, že jste informaci vzali na vědomí.'
    case 'pin':
      return 'PIN nastaven. Platí jen na tabletu na provozovně.'
    default:
      return 'Uloženo.'
  }
}

/* --- styly --------------------------------------------------------- */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  boxShadow: 'var(--shadow)',
  padding: '18px',
} as const

const nadpisKarty = { margin: '0 0 10px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '10px 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '66ch',
} as const

const ramecek = {
  margin: '0 0 12px',
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: '10px',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '14px',
} as const

const seznamUdaju = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 12em) minmax(0, 1fr)',
  gap: '6px 16px',
  margin: 0,
  fontSize: '14px',
} as const

const popisek = { color: 'var(--muted)', margin: 0 } as const
const hodnota = { color: 'var(--ink)', margin: 0 } as const

const poleLabel = {
  display: 'grid',
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const pole = {
  width: '100%',
  maxWidth: '340px',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const

const radekSouhlasu = {
  display: 'flex',
  gap: '14px',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  flexWrap: 'wrap' as const,
} as const

const textInformace = {
  margin: '0 0 12px',
  padding: '12px 14px',
  background: 'var(--paper)',
  border: '1px solid var(--line)',
  borderRadius: '10px',
  fontSize: '13.5px',
  lineHeight: 1.6,
  color: 'var(--ink)',
  whiteSpace: 'pre-wrap' as const,
  fontFamily: 'inherit',
  maxHeight: '340px',
  overflowY: 'auto' as const,
} as const
