import { odhlasit } from "../prihlaseni/akce";

export default function BezOrganizace() {
  return (
    <main className="prihlaseni">
      <div className="karta">
        <h1>Zatím bez přístupu</h1>
        <p className="muted">
          Váš účet zatím není členem žádné organizace, nebo nemáte přidělenou žádnou provozovnu. Vstup je jen na
          pozvánku — požádejte správce, aby vás přidal v nastavení týmu.
        </p>
        <form action={odhlasit}>
          <button className="btn" type="submit">Odhlásit se</button>
        </form>
      </div>
    </main>
  );
}
