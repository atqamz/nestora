import { useEffect, useMemo, useState } from "react";
import { routineDay, routineMinutes } from "../../shared/routines.ts";
import { routineRows } from "../domain/routines.ts";
import { routineFlows } from "../ui/routine-flows.ts";
import { actions, useSnapshot } from "./use-store.ts";

const MINUTE_MS = 60_000;

const REFRESH_MS = MINUTE_MS;

const useReading = <T,>(read: () => T) => {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const refresh = () => setValue(read());
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, []);
  return value;
};

export const useRoutineDay = () => useReading(() => routineDay(new Date()));

export const useRoutineClock = () => {
  const now = new Date(useReading(() => Math.floor(new Date().getTime() / MINUTE_MS)) * MINUTE_MS);
  return { day: routineDay(now), elapsed: routineMinutes(now) };
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
