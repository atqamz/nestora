import { useId } from "react";
import { owns } from "../domain/owner.ts";
import type { Owner } from "../domain/owner.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { text } from "./text.ts";

export function OwnerSelect({ value, onChange, owners }: { value: Owner; onChange: (owner: Owner) => void; owners: readonly (string | null)[] }) {
  const { me, label, nickname } = usePartner();
  const id = useId();
  if (me === null) return null;
  const options: [Owner, string][] = [
    ["everyone", text.owner.everyone],
    ["mine", nickname(me) ?? text.owner.mine],
    ["theirs", label(me === "a" ? "b" : "a")],
  ];
  return (
    <div className="owner-select">
      <label className="visually-hidden" htmlFor={id}>
        {text.owner.label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as Owner)}>
        {options.map(([owner, name]) => (
          <option key={owner} value={owner}>
            {name} · {owners.filter((who) => owns(who, owner, me)).length}
          </option>
        ))}
      </select>
    </div>
  );
}
