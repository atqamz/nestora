import type { SettingRow } from "../../shared/tables.ts";
import { parseStages } from "./stages.ts";
import type { Stage } from "./stages.ts";

export const DEFAULT_ZONE = "Asia/Jakarta";

export const settingKeys = {
  ceremonyDate: "ceremony_date",
  timezone: "timezone",
  partnerA: "partner_a_label",
  partnerB: "partner_b_label",
  photoA: "partner_a_photo",
  photoB: "partner_b_photo",
  stages: "stages",
  hijriOffset: "hijri_offset_days",
} as const;

export type Settings = {
  ceremonyDate: string | null;
  timezone: string;
  partnerA: string | null;
  partnerB: string | null;
  photoA: string | null;
  photoB: string | null;
  stages: readonly Stage[];
  hijriOffset: number;
};

export const readSettings = (rows: readonly SettingRow[]): Settings => {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    ceremonyDate: values.get(settingKeys.ceremonyDate) ?? null,
    timezone: values.get(settingKeys.timezone) ?? DEFAULT_ZONE,
    partnerA: values.get(settingKeys.partnerA) ?? null,
    partnerB: values.get(settingKeys.partnerB) ?? null,
    photoA: values.get(settingKeys.photoA) ?? null,
    photoB: values.get(settingKeys.photoB) ?? null,
    stages: parseStages(values.get(settingKeys.stages) ?? null),
    hijriOffset: Number(values.get(settingKeys.hijriOffset) ?? 0) || 0,
  };
};
