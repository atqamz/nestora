import type { Side } from "../shared/api.ts";

type Raw = Record<string, unknown>;

const flagged = (row: Raw | undefined) => row?.kind === "routine" && (row.data as Raw | null)?.private === true;

const withheld = (row: Raw | undefined, side: Side) => flagged(row) && row?.who !== side;

export const hides = (row: Raw, parent: Raw | undefined, side: Side) => withheld(row, side) || withheld(parent, side);

const PRIVATE = "kind = 'routine' AND json_extract(data, '$.private') IS 1 AND who IS NOT ?";

export const VISIBLE = `NOT coalesce((${PRIVATE}) OR parent_id IN (SELECT id FROM items WHERE ${PRIVATE}), 0)`;

export const gate = (table: string, side: Side): [string, Side[]] => (table === "items" ? [`AND ${VISIBLE}`, [side, side]] : ["", []]);

export const checkPrivacy = (items: Map<string, Raw>, side: Side, before: Raw | undefined, after: Raw): string[] => {
  const errors: string[] = [];
  if (after.kind === "routine") {
    if (before === undefined && flagged(after) && after.who !== side) errors.push("who: a private routine must belong to you");
    else if (before !== undefined && flagged(before) !== flagged(after)) errors.push("data.private: cannot be changed after creation");
    else if (before !== undefined && flagged(after) && before.who !== after.who) errors.push("who: cannot be changed on a private routine");
  }
  if (before !== undefined && flagged(items.get(before.parent_id as string)) !== flagged(items.get(after.parent_id as string))) {
    errors.push("parent_id: must keep the routine's visibility");
  }
  return errors;
};
