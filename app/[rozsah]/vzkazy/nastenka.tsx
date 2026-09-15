import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'

import { getUser, hasAccess, type Context, type Scope } from '@/lib/authz'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import { napsatZpravu, oznacitPrectene } from '../zpravy/akce'

/**
 * Nástěnka — druhá záložka Vzkazů.
 *
 * JE TO JEN OBSAH, ne celá obrazovka. Přihlášení, rozsah i nadpis řeší
 * `vzkazy/page.tsx`; sem se předá hotový kontext.
 *
 * SLOUČIL SE VCHOD, NE OBSAH. Nástěnka zůstává tím, čím byla:
 * jednosměrné sdělení „tohle vědí všichni", na které se neodpovídá
 * a u kterého se eviduje, kdo ho vzal na vědomí. Vzkazy jsou naopak
 * rozhovor. Dva různé tvary pod jednou položkou v nabídce.
 *
 * Zpráva bez pobočky (`branch_id` prázdné) patří celé firmě a vidí ji
 * i ten, kdo je na pobočce — proto se ptáme na „moje pobočka nebo nic".
 * Připnuté jdou nahoru.
 *
 * Přečtení se eviduje na kliknutí, ne při vykreslení: zápis do databáze
 * jen proto, že si někdo otevřel stránku, by byl vedlejší účinek, který
 * do vykreslování nepatří.
 */

const POCET = 50;

type Zprava = {
  id: string;
  branch_id: string | null;
  employee_id: string | null;
  usek_id: string | null;
  position_id: string | null;
  body: string;
  pinned: boolean;
  author_id: string | null;
  created_at: string;
  requires_acknowledgment: boolean;
};


export default async function Nastenka({
  tenantId,
  ctx,
  scope,
  rozsah,
}: {
  tenantId: string
  ctx: Context
  scope: Scope
  rozsah: string
}) {
  /*
    NÁSTĚNKA VISÍ NA `communication.read`, ROZHOVORY NE.

    Po sloučení pod jeden vchod se to nesmí ztratit. Kdyby se to
    právo vyžadovalo na celé obrazovce, nedostal by se do Vzkazů
    číšník, který ho v roli nemá — a přišel by tím i o vlastní
    vlákno. Kdyby se naopak nevyžadovalo nikde, četl by nástěnku
    i ten, komu ji firma zavřela.

    Ptá se tedy až tady, u té jedné záložky, a odpovědí je
    vysvětlení, ne prázdno.
  */
  const smiCist = await hasAccess(tenantId, 'communication.read', scope.branchId)
  if (!smiCist) {
    return (
      <Sdeleni nadpis="Na nástěnku nedosáhnete">
        Vaše oprávnění nástěnku neotvírá. Pokud si myslíte, že by mělo,
        řekněte si správci firmy o úpravu oprávnění. Vzkazy vám
        zůstávají.
      </Sdeleni>
    )
  }

  const muzePsat = await hasAccess(
    tenantId,
    'communication.manage',
    scope.branchId,
  )

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const user = await getUser();
  const supabase = await getServerSupabase();

  let dotaz = supabase
    .from("announcements")
    .select("id, branch_id, employee_id, usek_id, position_id, body, pinned, author_id, created_at, requires_acknowledgment")
    .eq("tenant_id", tenantId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(POCET);

  if (scope.level === "branch" && scope.branchId) {
    // Firemní zprávy (branch_id prázdné) patří i pobočce.
    dotaz = dotaz.or(`branch_id.eq.${scope.branchId},branch_id.is.null`);
  }

  const { data: zpravyData, error: chybaZpravyData } = await dotaz;
  if (chybaZpravyData) throw new DotazSelhal("zprávy na nástěnce", chybaZpravyData);
  const zpravy = (zpravyData ?? []) as Zprava[];

  // Co už mám přečtené. Politika pustí jen vlastní řádky, takže se
  // nemusí filtrovat podle user_id znovu — ale je to levné a čitelné.
  const prectene = new Set<string>();
  if (zpravy.length > 0 && user) {
    const { data: cteni, error: chybaCteni } = await supabase
      .from("announcement_reads")
      .select("announcement_id")
      .eq("user_id", user.id)
      .in(
        "announcement_id",
        zpravy.map((z) => z.id),
      );
    if (chybaCteni) throw new DotazSelhal("přečtené zprávy", chybaCteni);
    for (const c of cteni ?? []) prectene.add(c.announcement_id as string);
  }

  // Jména autorů. Politika profiles_select_colleagues pouští profily lidí
  // ze stejné firmy, takže dotaz projde; kdo se nenajde, zůstane bez jména.
  const autori = new Map<string, string>();
  const idAutoru = [
    ...new Set(
      zpravy.map((z) => z.author_id).filter((i): i is string => Boolean(i)),
    ),
  ];
  if (idAutoru.length > 0) {
    const { data: profily, error: chybaProfily } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", idAutoru);
    if (chybaProfily) throw new DotazSelhal("profily lidí", chybaProfily);
    for (const p of profily ?? []) {
      const jmeno = String(p.full_name ?? "").trim();
      if (jmeno !== "") autori.set(p.user_id as string, jmeno);
    }
  }

  // Kdo nepotvrdil — vidí jen vedoucí u oznámení s povinným potvrzením.
  // announcement_reads má RLS jen na vlastní řádky; RPC kdo_nepotvrdil
  // je SECURITY DEFINER a RLS obejde (pravidlo 7b).
  const nepotvrdiliMap = new Map<string, string[]>()
  if (muzePsat) {
    const vyzadujiciIds = zpravy
      .filter((z) => z.requires_acknowledgment)
      .map((z) => z.id)
    if (vyzadujiciIds.length > 0) {
      const vysledky = await Promise.all(
        vyzadujiciIds.map((id) =>
          supabase
            .rpc('kdo_nepotvrdil', { p_tenant: tenantId, p_announcement: id })
            .then((r) => ({
              id,
              data: (r.data ?? []) as { jmeno: string }[],
            })),
        ),
      )
      for (const { id, data } of vysledky) {
        if (data.length > 0) nepotvrdiliMap.set(id, data.map((d) => d.jmeno))
      }
    }
  }

  // Úseky a pozice — potřebujeme pro popisky v seznamu i pro selector.
  // Zaměstnanci jen pro vedoucí (selector může být velký seznam).
  type UsekRow     = { id: string; nazev: string; branch_id: string | null }
  type PoziceRow   = { id: string; label: string }
  type ZamRow      = { id: string; full_name: string | null }

  const usekyList: UsekRow[]   = []
  const poziceList: PoziceRow[] = []
  const zamestnanciList: ZamRow[] = []

  {
    const [usekyRes, poziceRes] = await Promise.all([
      supabase
        .from('useky')
        .select('id, nazev, branch_id')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('poradi'),
      supabase
        .from('positions')
        .select('id, label')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('label'),
    ])
    usekyList.push(...((usekyRes.data ?? []) as UsekRow[]))
    poziceList.push(...((poziceRes.data ?? []) as PoziceRow[]))

    if (muzePsat) {
      const zamRes = await supabase
        .from('employees')
        .select('id, full_name')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .order('full_name')
      zamestnanciList.push(...((zamRes.data ?? []) as ZamRow[]))
    }
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]));
  const usekyNazvy   = new Map(usekyList.map((u) => [u.id, u.nazev]));
  const poziceLabels = new Map(poziceList.map((p) => [p.id, p.label]));

  /*
    Vlastní `<Nadpis>` tu SCHVÁLNĚ NENÍ — kreslí ho shell nad záložkami.
    Dva nadpisy pod sebou by z jedné obrazovky udělaly dvě.

    Není tu ani vnější odsazení: to má taky shell, aby obě záložky
    seděly stejně.
  */
  return (
    <>
      <div>
        {muzePsat ? (
          <form
            action={napsatZpravu}
            style={{
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-lg)",
              padding: "14px",
              marginBottom: "20px",
            }}
          >
            <input type="hidden" name="rozsah" value={rozsah} />
            <label
              htmlFor="ft-nastenka-text"
              style={{
                display: "block",
                fontSize: "13px",
                color: "var(--muted)",
                marginBottom: "6px",
              }}
            >
              Nová zpráva
            </label>
            <textarea
              id="ft-nastenka-text"
              name="text"
              required
              rows={3}
              placeholder="Co mají vědět?"
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "16px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                background: "var(--paper)",
                color: "var(--ink)",
                resize: "vertical",
              }}
            />
            {/*
              Diktování. Většina lidí neví, že to jde — a je to dnes
              jediná hlasová cesta, která funguje i na iPhonu
              (`SpeechRecognition` v prohlížeči tam ne).

              Pole to unese: je to `textarea`, neřízená, bez měnícího se
              `key` a nic v okolí netiká po vteřinách. Kdyby se
              překreslovalo, diktování se uprostřed věty utne — je to
              tatáž chyba jako u vkládání přihlašovacího kódu.
            */}
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "12px",
                color: "var(--muted)",
              }}
            >
              Můžete i diktovat — mikrofon na klávesnici telefonu.
            </p>

            {/* KOMU — sjednocený adresát (B1) */}
            <div style={{ marginTop: "10px" }}>
              <label
                htmlFor="ft-nastenka-komu-typ"
                style={{
                  display: "block",
                  fontSize: "13px",
                  color: "var(--muted)",
                  marginBottom: "4px",
                }}
              >
                Komu
              </label>
              <select
                name="komu_typ"
                id="ft-nastenka-komu-typ"
                style={{
                  padding: "8px 10px",
                  fontSize: "15px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  background: "var(--paper)",
                  color: "var(--ink)",
                  width: "100%",
                }}
              >
                <option value="firma">Celá firma</option>
                {ctx.branches.length > 1 && (
                  <option value="pobocka">Pobočka…</option>
                )}
                {usekyList.length > 0 && (
                  <option value="usek">Úsek…</option>
                )}
                {poziceList.length > 0 && (
                  <option value="pozice">Pozice…</option>
                )}
                <option value="clovek">Konkrétní člověk…</option>
              </select>

              {/* Sekundární selektory — server přečte jen ten, co odpovídá komu_typ.
                  Bez JS jsou všechny viditelné; script je schová a odkrývá je
                  dynamicky. */}
              {ctx.branches.length > 1 && (
                <select
                  name="komu_id_pobocka"
                  id="ft-nastenka-sel-pobocka"
                  aria-label="Vyberte pobočku"
                  style={{
                    marginTop: "6px",
                    padding: "8px 10px",
                    fontSize: "15px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "var(--paper)",
                    color: "var(--ink)",
                    width: "100%",
                  }}
                >
                  {ctx.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}

              {usekyList.length > 0 && (
                <select
                  name="komu_id_usek"
                  id="ft-nastenka-sel-usek"
                  aria-label="Vyberte úsek"
                  style={{
                    marginTop: "6px",
                    padding: "8px 10px",
                    fontSize: "15px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "var(--paper)",
                    color: "var(--ink)",
                    width: "100%",
                  }}
                >
                  {usekyList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nazev}
                    </option>
                  ))}
                </select>
              )}

              {poziceList.length > 0 && (
                <select
                  name="komu_id_pozice"
                  id="ft-nastenka-sel-pozice"
                  aria-label="Vyberte pozici"
                  style={{
                    marginTop: "6px",
                    padding: "8px 10px",
                    fontSize: "15px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "var(--paper)",
                    color: "var(--ink)",
                    width: "100%",
                  }}
                >
                  {poziceList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}

              {zamestnanciList.length > 0 && (
                <select
                  name="komu_id_clovek"
                  id="ft-nastenka-sel-clovek"
                  aria-label="Vyberte zaměstnance"
                  style={{
                    marginTop: "6px",
                    padding: "8px 10px",
                    fontSize: "15px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "var(--paper)",
                    color: "var(--ink)",
                    width: "100%",
                  }}
                >
                  <option value="">Vyberte…</option>
                  {zamestnanciList.map((e) => (
                    <option key={e.id} value={e.id}>
                      {String(e.full_name ?? '').trim() || '(bez jména)'}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Skrytí/odkrytí sekundárních selectorů podle komu_typ. */}
            <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var typ = document.getElementById('ft-nastenka-komu-typ');
  if (!typ) return;
  var sels = {
    pobocka: document.getElementById('ft-nastenka-sel-pobocka'),
    usek:    document.getElementById('ft-nastenka-sel-usek'),
    pozice:  document.getElementById('ft-nastenka-sel-pozice'),
    clovek:  document.getElementById('ft-nastenka-sel-clovek'),
  };
  function upd() {
    var v = typ.value;
    for (var k in sels) { if (sels[k]) sels[k].hidden = (k !== v); }
  }
  for (var k in sels) { if (sels[k]) sels[k].hidden = true; }
  typ.addEventListener('change', upd);
  upd();
})();
            ` }} />

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "10px",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <label
                  style={{
                    fontSize: "14px",
                    color: "var(--muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <input type="checkbox" name="pripnout" value="ano" />
                  Připnout nahoru
                </label>
                <label
                  style={{
                    fontSize: "14px",
                    color: "var(--muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <input type="checkbox" name="vyzadat_potvrzeni" value="ano" />
                  Vyžadovat potvrzení
                </label>
              </div>
              <button type="submit" className="ft-tl ft-tl-hlavni">
                Odeslat
              </button>
            </div>
          </form>
        ) : null}

        {zpravy.length === 0 ? (
          <Sdeleni nadpis="Nástěnka je prázdná">
            {muzePsat
              ? "Zatím tu nic není. Napište první zprávu."
              : "Zatím tu nic není."}
          </Sdeleni>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "12px",
            }}
          >
            {zpravy.map((z) => {
              const jePrectena = prectene.has(z.id);
              const firemni = z.branch_id === null;

              return (
                <li
                  key={z.id}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    borderLeft: z.pinned
                      ? "4px solid var(--warn)"
                      : "1px solid var(--line)",
                    borderRadius: "12px",
                    padding: "14px",
                    opacity: jePrectena ? 0.72 : 1,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: "12px",
                      color: "var(--muted)",
                    }}
                  >
                    {[
                      z.pinned ? "Připnuto" : null,
                      z.author_id ? autori.get(z.author_id) : null,
                      // Adresát: úsek/pozice mají přednost před pobočkou.
                      z.usek_id
                        ? (usekyNazvy.get(z.usek_id) ?? "úsek")
                        : z.position_id
                          ? (poziceLabels.get(z.position_id) ?? "pozice")
                          : z.employee_id
                            ? "osobní"
                            : firemni
                              ? "celá firma"
                              : scope.level === "tenant"
                                ? (nazvyPobocek.get(z.branch_id as string) ?? "jiná pobočka")
                                : null,
                      datumACas(z.created_at),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>

                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: "15px",
                      color: "var(--ink)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {z.body}
                  </p>

                  {jePrectena ? (
                    <p
                      style={{
                        margin: "10px 0 0",
                        fontSize: "12px",
                        color: "var(--good)",
                      }}
                    >
                      {z.requires_acknowledgment ? '✓ Potvrzeno' : '✓ Přečteno'}
                    </p>
                  ) : (
                    <form action={oznacitPrectene} style={{ marginTop: "10px" }}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="zprava" value={z.id} />
                      <button
                        type="submit"
                        className={
                          z.requires_acknowledgment
                            ? 'ft-tl ft-tl-hlavni ft-tl-male'
                            : 'ft-tl ft-tl-vedlejsi ft-tl-male'
                        }
                      >
                        {z.requires_acknowledgment ? 'Beru na vědomí' : 'Označit jako přečtené'}
                      </button>
                    </form>
                  )}

                  {muzePsat && z.requires_acknowledgment && nepotvrdiliMap.has(z.id) ? (
                    <p
                      style={{
                        margin: "10px 0 0",
                        fontSize: "12px",
                        color: "var(--muted)",
                        borderTop: "1px solid var(--line)",
                        paddingTop: "8px",
                      }}
                    >
                      Nepotvrdili: {nepotvrdiliMap.get(z.id)!.join(', ')}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

/*
  Pásmo se dodává vždycky. Bez něj bere JavaScript pásmo serveru — na
  Vercelu UTC — a čas je v létě o dvě hodiny vedle. Viz lib/cas.ts.
*/
function datumACas(iso: string, zona?: string): string {
  return datumACasVPasmu(iso, zona ?? ZONA_VYCHOZI);
}
