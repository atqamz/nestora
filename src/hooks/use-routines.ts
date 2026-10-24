import { useEffect, useMemo, useState } from "react";
import { routineDay } from "../../shared/routines.ts";
import { routineRows } from "../domain/routines.ts";
import { routineFlows } from "../ui/routine-flows.ts";
import { actions, useSnapshot } from "./use-store.ts";

const REFRESH_MS = 60_000;

export const useRoutineDay = () => {
  const [day, setDay] = useState(() => routineDay(new Date()));
  useEffect(() => {
    const refresh = () => setDay(routineDay(new Date()));
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, []);
  return day;
};

export const useRoutines = () => {
  const { me, rows } = useSnapshot();
  const day = useRoutineDay();
  const items = useMemo(() => routineRows(rows.items, me), [rows.items, me]);
  return { items, me, day };
};

export const useRoutineFlows = ({ items, me, day }: ReturnType<typeof useRoutines>) =>
  routineFlows({
    items,
    actions,
    me,
    day,
    go: (hash) => {
      location.hash = hash;
    },
  });
