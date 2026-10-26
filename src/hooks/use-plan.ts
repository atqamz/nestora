import type { Side } from "../../shared/api.ts";
import { useEffect, useMemo, useState } from "react";
import { todayIn } from "../domain/dates.ts";
import { photoFor } from "../domain/photo.ts";
import { sideName } from "../domain/names.ts";
import { readSettings } from "../domain/settings.ts";
import { text } from "../ui/text.ts";
import { useSnapshot, useTable } from "./use-store.ts";

export const useSettings = () => {
  const rows = useTable("settings");
  return useMemo(() => readSettings(rows), [rows]);
};

export const useToday = () => {
  const { timezone } = useSettings();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  return todayIn(now, timezone);
};

export const useStamp = () => {
  const { timezone } = useSettings();
  return () => todayIn(new Date(), timezone);
};

export const usePartner = () => {
  const { partnerA, partnerB, photoA, photoB } = useSettings();
  const { me, link } = useSnapshot();
  const label = (side: string | null) => sideName(side, me, { a: partnerA, b: partnerB }, text);
  const photo = (side: Side | null) => photoFor(side, { a: photoA, b: photoB }, link);
  const nickname = (side: Side | null) => (side === "a" ? partnerA : side === "b" ? partnerB : null)?.trim() || null;
  return { me, label, nickname, photo };
};
