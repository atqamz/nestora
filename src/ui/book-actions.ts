import { usePartner, useStamp } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { bookFlows } from "./book-flows.ts";

export const useBookActions = () => {
  const items = useTable("items");
  const stamp = useStamp();
  const { me } = usePartner();
  return bookFlows({
    items,
    actions,
    stamp,
    me,
    go: (hash) => {
      location.hash = hash;
    },
  });
};
