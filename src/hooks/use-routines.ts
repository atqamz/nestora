import { useEffect, useMemo, useState } from "react";
import { routineDay } from "../../shared/routines.ts";
import { routineRows } from "../domain/routines.ts";
import { routineFlows } from "../ui/routine-flows.ts";
import { clockAt, minuteOf, watch } from "./clock.ts";
import { actions, useSnapshot } from "./use-store.ts";

const useReading = <T,>(read: () => T) => {
  const [value, setValue] = useState(read);
  useEffect(() => watch(() => setValue(read())), []);
  return value;
};

export const useRoutineDay = () => useReading(() => routineDay(new Date()));

export const useRoutineClock = () => clockAt(useReading(() => minuteOf(new Date())));

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
