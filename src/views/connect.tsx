import { useBusy } from "../hooks/use-busy.ts";
import { actions } from "../hooks/use-store.ts";
import { text } from "../ui/text.ts";
import { Entry } from "./entry.tsx";

export function Connect() {
  const { busy, once } = useBusy();
  return (
    <Entry title={text.connect.title} body={text.connect.body} live>
      <button type="button" className="entry-action" disabled={busy} onClick={() => once(() => actions.sync())}>
        {text.connect.retry}
      </button>
    </Entry>
  );
}
