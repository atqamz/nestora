import { useState } from "react";
import { zoneSupported } from "../domain/dates.ts";
import { hijriChoices, hijriOf } from "../domain/hijri.ts";
import { DEFAULT_ZONE, settingKeys } from "../domain/settings.ts";
import { useSettings } from "../hooks/use-plan.ts";
import { actions, useSnapshot } from "../hooks/use-store.ts";
import { Avatar } from "../ui/avatar.tsx";
import { failureOf } from "../ui/failure.ts";
import { FeedSection } from "../ui/feed-section.tsx";
import { Field } from "../ui/field.tsx";
import { formatLong } from "../ui/format.ts";
import { Icon } from "../ui/icons.tsx";
import { overlay } from "../ui/overlay.ts";
import { exportQuery, views } from "../ui/registry.ts";
import type { ViewName } from "../ui/registry.ts";
import { SettingRow } from "../ui/setting-row.tsx";
import { StageEditor } from "../ui/stage-editor.tsx";
import { text } from "../ui/text.ts";
import { THEMES, readTheme, saveTheme } from "../ui/theme.ts";
import type { Theme } from "../ui/theme.ts";
import { Title } from "../ui/title.tsx";

export const LOGOUT_URL = "/cdn-cgi/access/logout";

const exports = [
  { label: text.settings.exportAll, query: "format=json" },
  ...(Object.keys(views) as ViewName[]).map((name) => ({
    label: text.export[name],
    query: exportQuery(name),
  })),
];

const THEME_ICON = { system: "device", light: "sun", dark: "moon" } as const;

const store = (key: string, check?: (value: string) => string | null) => async (value: string) => {
  if (value === "") return text.settings.noEmpty;
  const problem = check?.(value) ?? null;
  if (problem !== null) return problem;
  const errors = failureOf(await actions.setSetting(key, value));
  if (errors.length > 0) return errors.join(" ");
  overlay.announce(text.saved);
  return null;
};

export function Settings() {
  const settings = useSettings();
  const { me } = useSnapshot();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [failure, setFailure] = useState<string[]>([]);
  const hijri = settings.ceremonyDate === null ? null : hijriOf(settings.ceremonyDate, settings.hijriOffset);
  const sides = me === "b" ? (["b", "a"] as const) : (["a", "b"] as const);
  const keys = { a: settingKeys.partnerA, b: settingKeys.partnerB };
  const nicknames = { a: settings.partnerA, b: settings.partnerB };

  const chooseOffset = async (value: string) => {
    const errors = failureOf(await actions.setSetting(settingKeys.hijriOffset, value));
    setFailure(errors);
    if (errors.length === 0) overlay.announce(text.saved);
  };

  return (
    <>
      <Title>{text.nav.settings}</Title>
      <div className="set">
        <h2>{text.settings.day}</h2>
        <ul className="setl">
          <SettingRow
            field={{ name: settingKeys.ceremonyDate, label: text.settings.ceremonyDate, type: "date", value: settings.ceremonyDate }}
            kicker={text.settings.ceremonyShort}
            shown={settings.ceremonyDate === null ? text.settings.notSet : formatLong(settings.ceremonyDate)}
            notes={hijri === null ? undefined : <small>{hijri}</small>}
            what={text.settings.what.date}
            save={store(settingKeys.ceremonyDate)}
          />
          <SettingRow
            field={{
              name: settingKeys.timezone,
              label: text.settings.timezone,
              type: "zone",
              value: settings.timezone,
              suggestions: [DEFAULT_ZONE, "Asia/Makassar", "Asia/Jayapura"],
            }}
            kicker={text.settings.timezone}
            shown={settings.timezone}
            notes={zoneSupported(settings.timezone) ? undefined : <small role="status">{text.settings.zoneUnsupported}</small>}
            what={text.settings.what.zone}
            save={store(settingKeys.timezone, (value) => (zoneSupported(value) ? null : text.settings.zoneInvalid))}
          />
        </ul>
        {settings.ceremonyDate !== null && (
          <div className="set-block">
            <Field
              control={{
                name: "hijri",
                label: text.settings.hijriAdjust,
                type: "text",
                required: true,
                choice: true,
                value: String(settings.hijriOffset),
                options: hijriChoices(settings.hijriOffset).map((offset) => ({ value: String(offset), label: text.settings.hijriOffset[String(offset) as keyof typeof text.settings.hijriOffset] })),
                hint: hijri === null ? text.settings.hijriUnavailable : text.settings.hijriNote,
                onChange: chooseOffset,
              }}
            />
          </div>
        )}
        {failure.length > 0 && (
          <p className="error" role="alert">
            {failure.join(" ")}
          </p>
        )}
        <StageEditor saved={settings.stages} ceremony={settings.ceremonyDate} />

        <h2>{text.settings.two}</h2>
        <ul className="setl setl-two">
          {sides.map((side) => (
            <SettingRow
              key={side}
              lead={<Avatar side={side} size={44} />}
              field={{ name: keys[side], label: side === me ? text.settings.yourNickname : text.settings.theirNickname, type: "text", value: nicknames[side], words: true }}
              kicker={side === me ? text.settings.yourNickname : text.settings.theirNickname}
              shown={<b>{nicknames[side] ?? text.settings.noNickname}</b>}
              notes={side === me ? <small>{text.settings.youSignedIn}</small> : undefined}
              what={side === me ? text.settings.what.mine : text.settings.what.theirs}
              save={store(keys[side])}
            />
          ))}
        </ul>
        <p className="set-n">{text.settings.nicknamesNote}</p>

        <h2>{text.settings.look}</h2>
        <Field
          control={{
            name: "theme",
            label: text.settings.lookLabel,
            type: "text",
            required: true,
            choice: true,
            value: theme,
            hint: text.settings.lookNote,
            options: THEMES.map((value) => ({ value, label: text.settings.theme[value], icon: <Icon name={THEME_ICON[value]} /> })),
            onChange: (value) => {
              saveTheme(value as Theme);
              setTheme(value as Theme);
            },
          }}
        />

        {me !== null && <FeedSection side={me} zone={settings.timezone} />}

        <h2>{text.settings.data}</h2>
        <p className="hint">{text.settings.exportBody}</p>
        <ul className="links">
          {exports.map((link) => (
            <li key={link.query}>
              <a href={`/api/export?${link.query}&side=${me}`} download>
                <Icon name="download" />
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="trail">
          <a href="#/sync">{text.settings.syncDetails}</a>
        </p>
        <a className="button secondary out" href={LOGOUT_URL}>
          <Icon name="door" />
          {text.settings.signOut}
        </a>
        <p className="hint">{text.settings.signOutNote}</p>
      </div>
    </>
  );
}
