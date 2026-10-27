import { useEffect } from "react";
import type { ReactNode } from "react";
import { tintThemeColor } from "../ui/theme-color.ts";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { LOGIN_URL } from "../store/api.ts";

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function Entry({ title, body, live, note, children }: { title: string; body: string; live?: true; note?: string; children: ReactNode }) {
  useEffect(() => tintThemeColor([...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]), []);

  useEffect(() => {
    document.title = `${title} · ${text.appName}`;
    document.querySelector<HTMLElement>("h1")?.focus();
  }, [title]);

  return (
    <main className="entry">
      <svg className="entry-route" viewBox="0 30 390 270" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <path d="M-2000 60H170a40 40 0 0 1 40 40V230a40 40 0 0 0 40 40H2400" />
        <circle cx="90" cy="60" r="7" />
        <circle className="now" cx="210" cy="160" r="11" />
        <circle className="day" cx="322" cy="270" r="13" />
        <circle className="day" cx="340" cy="270" r="13" />
      </svg>
      <div className="entry-body">
        <span className="entry-brand">{text.appName}</span>
        <Title>{title}</Title>
        <p role={live ? "status" : undefined}>{body}</p>
        {children}
        {note && <p className="entry-note">{note}</p>}
      </div>
    </main>
  );
}

const Login = ({ action }: { action: string }) => (
  <a className="button entry-action" href={LOGIN_URL}>
    <GoogleMark />
    {action}
  </a>
);

export const SignIn = () => (
  <Entry title={text.signIn.title} body={text.signIn.body} note={text.signIn.note}>
    <Login action={text.signIn.action} />
  </Entry>
);

export const Denied = () => (
  <Entry title={text.denied.title} body={text.denied.body}>
    <Login action={text.denied.action} />
  </Entry>
);
