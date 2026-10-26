import { owns } from "../domain/owner.ts";
import type { Owner } from "../domain/owner.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { text } from "./text.ts";

export function OwnerFilter({ value, onChange, owners }: { value: Owner; onChange: (owner: Owner) => void; owners: readonly (string | null)[] }) {
  const { me, label, nickname } = usePartner();
  if (me === null) return null;
  const options: [Owner, string][] = [
    ["everyone", text.owner.everyone],
    ["mine", nickname(me) ?? text.owner.mine],
    ["theirs", label(me === "a" ? "b" : "a")],
  ];
  return (
    <div role="group" aria-label={text.owner.label} className="seg">
      {options.map(([owner, name]) => (
        <button key={owner} type="button" aria-pressed={value === owner} onClick={() => onChange(owner)}>
          {name} <b>{owners.filter((who) => owns(who, owner, me)).length}</b>
        </button>
      ))}
    </div>
  );
}
