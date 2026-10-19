import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { budgetOf, dueSoon } from "../domain/budget.ts";
import { daysUntil } from "../domain/dates.ts";
import { lately } from "../domain/lately.ts";
import { routeOf } from "../domain/stages.ts";
import type { Station } from "../domain/stages.ts";
import { thisWeek } from "../domain/week.ts";
import type { WeekEntry } from "../domain/week.ts";
import { hijriOf } from "../domain/hijri.ts";
import { useSettings, useToday, usePartner } from "../hooks/use-plan.ts";
import { useTable } from "../hooks/use-store.ts";
import { Avatar } from "../ui/avatar.tsx";
import { Capture } from "../ui/capture.tsx";
import { formatDay, formatLong, formatMonths, formatStamp } from "../ui/format.ts";
import { Icon } from "../ui/icons.tsx";
import { ItemLine } from "../ui/item-line.tsx";
import { Money } from "../ui/money.tsx";
import { PaymentLine } from "../ui/payment-line.tsx";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";

function Entries({ id, heading, late, entries }: { id: string; heading: string; late?: true; entries: WeekEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="group" aria-labelledby={id}>
      <h3 id={id} data-late={late}>
        {heading} <span>{entries.length}</span>
      </h3>
      <ul className="rows">
        {entries.map((entry) =>
          entry.type === "task" ? (
            <ItemLine key={entry.row.id} name="task" row={entry.row} />
          ) : (
            <PaymentLine key={entry.row.id} payment={entry.row} />
          ),
        )}
      </ul>
    </section>
  );
}

type Route = { stations: Station[]; ceremony: string; today: string };

const when = ({ stations, ceremony, today }: Route, index: number) =>
  stations[index].day && stations[index].from === stations[index].to ? formatDay(ceremony, today) : formatMonths(stations[index].start, stations[index].end);

const progress = (station: Station) =>
  station.total === 0
    ? null
    : station.state === "past"
      ? station.done === station.total
        ? text.route.allDone(station.total)
        : text.route.open(station.total - station.done)
      : station.state === "now"
        ? text.route.progress(station.done, station.total)
        : text.route.tasks(station.total);

function Strip({ route }: { route: Route }) {
  const last = route.stations.length - 1;
  const past = route.stations.filter((station) => station.state === "past").length;
  return (
    <ol className="strip" aria-label={text.route.label} style={{ "--n": Math.max(last, 1), "--at": Math.min(past, last) } as CSSProperties}>
      {route.stations.map((station, index) => (
        <li
          key={station.key}
          className="st"
          data-state={station.state}
          data-day={station.day || undefined}
          style={{ "--i": index } as CSSProperties}
        >
          <span className="mk" aria-hidden="true" />
          <b>{station.name}</b>
          <span>{station.state === "now" ? text.route.here : when(route, index)}</span>
        </li>
      ))}
    </ol>
  );
}

function Spine({ route, work }: { route: Route; work: ReactNode }) {
  return (
    <div className="spine">
      <ol className="stops">
        {route.stations.map((station, index) => (
          <li key={station.key} className="stop" data-state={station.state} data-day={station.day || undefined}>
            <span className="mk" aria-hidden="true" />
            <div className="stop-h">
              <h2>{station.name}</h2>
              <p>
                {station.state === "now" && <span className="here">{text.route.here}</span>}
                {station.state === "past" && station.total > 0 && station.done === station.total && <Icon name="check" />}
                {[when(route, index), progress(station)].filter(Boolean).join(" · ")}
              </p>
            </div>
            {station.state === "now" && <div className="now-body">{work}</div>}
          </li>
        ))}
      </ol>
      {route.stations.every((station) => station.state !== "now") && <div className="loose">{work}</div>}
    </div>
  );
}

export function Home() {
  const items = useTable("items");
  const entries = useTable("budget_entries");
  const { ceremonyDate, timezone, stages, hijriOffset } = useSettings();
  const { label } = usePartner();
  const today = useToday();
  const week = useMemo(() => thisWeek(items, entries, today), [items, entries, today]);
  const budget = useMemo(() => budgetOf(entries), [entries]);
  const route = useMemo(
    () => (ceremonyDate === null ? null : { stations: routeOf(ceremonyDate, today, items, stages), ceremony: ceremonyDate, today }),
    [ceremonyDate, today, items, stages],
  );
  const recent = useMemo(() => lately(items, entries), [items, entries]);
  const days = daysUntil(ceremonyDate, today);
  const hijri = ceremonyDate === null ? null : hijriOf(ceremonyDate, hijriOffset);
  const empty = week.overdue.length + week.soon.length + week.undated.length === 0;

  const work = (
    <>
      <Capture />
      {empty && <p className="empty">{text.week.empty}</p>}
      <Entries id="week-overdue" heading={text.week.overdue} late entries={week.overdue} />
      <Entries id="week-soon" heading={text.week.soon} entries={week.soon} />
      {week.undated.length > 0 && (
        <section className="group" aria-labelledby="week-undated">
          <h3 id="week-undated">
            {text.week.undated} <span>{week.undated.length}</span>
          </h3>
          <ul className="rows">
            {week.undated.map((row) => (
              <ItemLine key={row.id} name="task" row={row} />
            ))}
          </ul>
        </section>
      )}
      <p className="trail">
        <a href="#/tasks">{text.route.allTasks}</a>
      </p>
    </>
  );

  return (
    <>
      <div className="hero">
        <div className="count">
          {days === null ? (
            <Title className="count-n">
              <a href="#/settings">{text.countdown.unset}</a>
            </Title>
          ) : (
            <Title className="count-n">
              {days === 0 ? (
                <span className="count-u">{text.countdown.today}</span>
              ) : (
                <>
                  <span className="num">{Math.abs(days)}</span>{" "}
                  <span className="count-u">{days > 0 ? text.countdown.to(days) : text.countdown.since(-days)}</span>
                </>
              )}
            </Title>
          )}
          {ceremonyDate && (
            <p className="count-d">
              {formatLong(ceremonyDate)}
              {hijri && <> · {hijri}</>}
            </p>
          )}
        </div>
        {budget.groups.length > 0 && (
          <p className="hero-money">
            <span>
              <b>
                <Money rupiah={dueSoon(budget, today)} />
              </b>{" "}
              {text.money.due}
            </span>
            <span>
              <b>
                <Money rupiah={budget.remaining} />
              </b>{" "}
              {text.money.left}
            </span>
          </p>
        )}
        {route && <Strip route={route} />}
      </div>
      <div className="home">
        {route ? (
          <Spine route={route} work={work} />
        ) : (
          <div className="spine">
            <h2 className="visually-hidden">{text.week.heading}</h2>
            <div className="loose">{work}</div>
          </div>
        )}
        {recent.length > 0 && (
          <aside className="side" aria-labelledby="lately">
            <h2 id="lately">{text.lately.heading}</h2>
            <ul>
              {recent.map((activity) => (
                <li key={activity.id}>
                  <Avatar side={activity.by} size={28} />
                  <p>
                    <b>{label(activity.by)}</b> {text.lately.verb[activity.verb]} {activity.title}
                    {activity.to !== null && ` ${text.lately.to} ${activity.to}`}
                    <span>{formatStamp(activity.at, timezone)}</span>
                  </p>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </>
  );
}
