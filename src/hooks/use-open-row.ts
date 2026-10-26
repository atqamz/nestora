import { useRef } from "react";
import { openRow } from "../domain/open-row.ts";

export const useOpenRow = <T>(live: T | undefined) => {
  const last = useRef(live);
  const open = openRow(last.current, live);
  last.current = open.row;
  return open;
};
