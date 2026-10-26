import { text } from "./text.ts";

export function TmdbCredit() {
  return (
    <p className="hint credit tmdb">
      <a className="tmdb-logo" href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
        <img src="/tmdb.svg" alt={text.tmdb.logo} decoding="async" />
      </a>
      <span>{text.tmdb.credit}</span>
    </p>
  );
}
