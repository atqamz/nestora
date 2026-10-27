import { useState } from "react";
import type { FormEvent } from "react";
import { sortBefore } from "../domain/order.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { failureOf } from "./failure.ts";
import { firstStatus } from "./registry.ts";
import type { ListName } from "./registry.ts";
import { text } from "./text.ts";

export function QuickAdd({ name }: { name: ListName }) {
  const items = useTable("items");
  const { me } = usePartner();
  const { busy, once } = useBusy();
  const [errors, setErrors] = useState<string[]>([]);

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    if (title === "") return;
    return once(async () => {
      const result = await actions.create("items", {
        kind: name,
        title,
        status: firstStatus(name)!,
        sort: sortBefore(items.filter((item) => item.kind === name)),
        ...(name === "guest" ? { who: me ?? "a" } : {}),
      });
      if (result.ok) form.reset();
      setErrors(failureOf(result));
    });
  };

  return (
    <form className="quick-add" onSubmit={add}>
      <label className="visually-hidden" htmlFor={`add-${name}`}>
        {text.quickAdd[name].label}
      </label>
      <input
        id={`add-${name}`}
        name="title"
        required
        maxLength={500}
        autoComplete="off"
        enterKeyHint="done"
        placeholder={text.quickAdd[name].placeholder}
      />
      <button type="submit" disabled={busy} aria-label={text.quickAdd[name].placeholder}>
        {text.add}
      </button>
      {errors.length > 0 && (
        <p className="error" role="alert">
          {errors.join(" ")}
        </p>
      )}
    </form>
  );
}
