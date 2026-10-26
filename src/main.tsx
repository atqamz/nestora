import { StrictMode, useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { takeDenied } from "./domain/access.ts";
import { screenFor } from "./domain/status.ts";
import { openStore, useSnapshot } from "./hooks/use-store.ts";
import { useRoute } from "./router.ts";
import { tabStorage } from "./store/browser.ts";
import { ErrorBoundary } from "./ui/error-boundary.tsx";
import { landPlace, startPlace } from "./ui/place.ts";
import { Recovery } from "./ui/recovery-screen.tsx";
import { screenOf } from "./ui/routes.ts";
import { Shell } from "./ui/shell.tsx";
import { text } from "./ui/text.ts";
import { applyTheme, readTheme } from "./ui/theme.ts";
import { Title } from "./ui/title.tsx";
import { Books } from "./views/books.tsx";
import { Connect } from "./views/connect.tsx";
import { Denied, SignIn } from "./views/entry.tsx";
import { GenericItem } from "./views/generic-item.tsx";
import { Home } from "./views/home.tsx";
import { Journey } from "./views/journey.tsx";
import { MoneyView } from "./views/money.tsx";
import { People } from "./views/people.tsx";
import { Routines } from "./views/routines.tsx";
import { Screens } from "./views/screens.tsx";
import { Settings } from "./views/settings.tsx";
import { Sync } from "./views/sync.tsx";
import { Tasks } from "./views/tasks.tsx";
import "./tokens.css";
import "./style.css";
import "./ui/ui.css";
import "./ui/sheet.css";
import "./views/journey.css";
import "./views/money.css";
import "./views/people.css";
import "./views/books.css";
import "./views/routines.css";
import "./views/import.css";
import "./views/settings.css";
import "./views/entry.css";

function Page({ section, id, sub }: { section: string; id?: string; sub?: string }) {
  const screen = screenOf(section);
  switch (screen) {
    case "home":
      return <Home />;
    case "marriage":
      return <Journey />;
    case "tasks":
      return id ? <GenericItem key={id} name="task" id={id} /> : <Tasks />;
    case "routines":
      return <Routines id={id} sub={sub} />;
    case "money":
      return <MoneyView id={id} />;
    case "payments":
      return id ? <GenericItem key={id} name="payment" id={id} /> : <MoneyView />;
    case "people":
      return <People route={section} id={id} />;
    case "books":
      return <Books route={section} id={id} />;
    case "movies":
      return <Screens kind="movie" id={id} />;
    case "series":
      return <Screens kind="series" id={id} />;
    case "settings":
      return <Settings />;
    case "sync":
      return <Sync />;
    case null:
      return <Title>{text.notFound}</Title>;
    default:
      return screen satisfies never;
  }
}

function App() {
  const route = useRoute();
  const [section = "", id, sub] = route.split("/").filter(Boolean);
  const first = useRef(true);
  const last = useRef<{ section: string; id?: string; split: Element | null }>({ section, split: null });

  useLayoutEffect(() => {
    const now = document.querySelector(".split");
    const beside = now !== null && now === last.current.split && now.hasAttribute("data-wide") && section === last.current.section;
    const selecting = beside && id !== undefined;
    const closing = beside && id === undefined && last.current.id !== undefined;
    const row = closing ? now?.querySelector<HTMLElement>(`a[href$="/${CSS.escape(last.current.id!)}"]`) : null;
    const how = first.current ? "first" : selecting || closing ? "beside" : "move";
    first.current = false;
    landPlace(how);
    if (closing) (row ?? document.querySelector<HTMLElement>("h1"))?.focus({ preventScroll: !row });
  }, [route]);

  useEffect(() => {
    last.current = { section, id, split: document.querySelector(".split") };
  });

  useEffect(() => {
    const heading = document.querySelector("h1")?.textContent;
    document.title = heading ? `${heading} · ${text.appName}` : text.appName;
  });

  const screen = screenFor(useSnapshot());
  if (screen === "loading") return <p className="splash" role="status">{text.loading}</p>;
  if (screen === "signin") return <SignIn />;
  if (screen === "connect") return <Connect />;
  return (
    <Shell section={section}>
      <Page section={section} id={id} sub={sub} />
    </Shell>
  );
}

applyTheme(readTheme());
startPlace(tabStorage);

const root = createRoot(document.getElementById("root")!);

if (takeDenied(location, history)) {
  root.render(
    <StrictMode>
      <Denied />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );

  openStore().catch(() => root.render(<Recovery title={text.storageBrokenTitle} body={text.storageBroken} />));
}
