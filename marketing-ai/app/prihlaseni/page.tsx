import { redirect } from "next/navigation";

import { bezpecnyCil } from "@/lib/auth/kam";
import { getSession, isDemoMode } from "@/lib/auth/session";
import { DEMO_USERS } from "@/lib/demo-ucty";

import { prihlasitDemo, poslatKod, overitKod } from "./akce";

export const dynamic = "force-dynamic";

export default async function Prihlaseni({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const kam = bezpecnyCil(sp.kam);
  const session = await getSession();
  if (session) redirect(kam);

  const demo = isDemoMode();
  const email = sp.email ?? "";
  const chyba = sp.chyba;

  return (
    <main className="prihlaseni">
      <div className="karta">
        <p className="brand" style={{ color: "var(--ink)" }}>
          Food<em>Tab</em> <small style={{ color: "var(--muted)" }}>Marketing AI</small>
        </p>
        <h1>Přihlášení</h1>
        {demo ? (
          <>
            <p className="muted">
              Demo režim: vyberte účet. Žádné heslo, žádná skutečná data. V ostrém provozu se přihlašuje pracovním
              e-mailem a zaslaným kódem, stejně jako ve FoodTab Řízení.
            </p>
            <div className="hlaska hlaska-pozor male">
              Po přihlášení se vrátíte na <code>{kam}</code>.
            </div>
            <form action={prihlasitDemo} className="demo-ucty">
              <input type="hidden" name="kam" value={kam} />
              {DEMO_USERS.map((u) => (
                <button key={u.id} className="btn" name="userId" value={u.id} type="submit">
                  <span>{u.name}</span>
                  <small>{u.description}</small>
                </button>
              ))}
            </form>
          </>
        ) : sp.krok === "kod" ? (
          <form action={overitKod}>
            <input type="hidden" name="kam" value={kam} />
            <input type="hidden" name="email" value={email} />
            <p className="muted">Na adresu <b>{email}</b> jsme poslali kód. Opište ho sem.</p>
            {chyba && <div className="hlaska hlaska-bad">{chyba}</div>}
            <div className="pole">
              <label htmlFor="kod">Kód z e-mailu</label>
              <input id="kod" name="kod" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
            </div>
            <button className="btn btn-primary" type="submit">Přihlásit se</button>
          </form>
        ) : (
          <form action={poslatKod}>
            <input type="hidden" name="kam" value={kam} />
            <p className="muted">Zadejte pracovní e-mail. Pošleme vám kód, heslo nepotřebujete.</p>
            {chyba && <div className="hlaska hlaska-bad">{chyba}</div>}
            <div className="pole">
              <label htmlFor="email">Pracovní e-mail</label>
              <input id="email" name="email" type="email" autoComplete="email" required defaultValue={email} />
            </div>
            <button className="btn btn-primary" type="submit">Poslat kód</button>
          </form>
        )}
      </div>
    </main>
  );
}
