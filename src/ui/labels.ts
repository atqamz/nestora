import type { Side } from "../../shared/api.ts";
import { settingKeys } from "../domain/settings.ts";
import { text } from "./text.ts";
import type { ViewName } from "./registry.ts";

type Labels = Record<string, string>;

export const fieldLabel = (name: ViewName, field: string) =>
  (text.field as Record<string, Labels>)[name]?.[field] ?? (text.field.common as Labels)[field] ?? field;

export const optionLabel = (name: ViewName, field: string, value: string, side: (who: string) => string) =>
  field === "who"
    ? side(value)
    : ((text.option as Record<string, Labels>)[`${name}.${field}`]?.[value] ?? (text.option as Record<string, Labels>)[field]?.[value] ?? value);

const owned: Record<string, { side: Side; mine: string; theirs: string }> = {
  [settingKeys.partnerA]: { side: "a", mine: text.settings.yourNickname, theirs: text.settings.theirNickname },
  [settingKeys.partnerB]: { side: "b", mine: text.settings.yourNickname, theirs: text.settings.theirNickname },
  [settingKeys.photoA]: { side: "a", mine: text.settings.yourPhoto, theirs: text.settings.theirPhoto },
  [settingKeys.photoB]: { side: "b", mine: text.settings.yourPhoto, theirs: text.settings.theirPhoto },
};

export const settingName = (key: string, me: Side | null) => {
  if (Object.hasOwn(owned, key)) return owned[key].side === me ? owned[key].mine : owned[key].theirs;
  return (text.sync.setting as Labels)[key] ?? key;
};

const FOR_KEY = /\bfor key ([a-z][a-z0-9_]*)/g;

export const reasonText = (reason: string, me: Side | null) => reason.replace(FOR_KEY, (_, key: string) => `for ${settingName(key, me).toLowerCase()}`);
