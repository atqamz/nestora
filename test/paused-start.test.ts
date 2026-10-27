import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { overlay } from "../src/ui/overlay.ts";
import { text } from "../src/ui/text.ts";
import { begin } from "../src/domain/routine-timer.ts";
import { item } from "./domain-rows.ts";
import { find, mount } from "./mount.ts";
import { markupOf } from "./render.ts";
import { actions, stage, timers, useSnapshot } from "./render-store.ts";
import { createElement } from "react";

const load = async (module: string) => {
  let loaded!: Record<string, any>;
  await markupOf(module, (found) => ((loaded = found), createElement("i")));
  return loaded;
};

const { RoutineStart } = await load("views/routine-start.tsx");
const { StartPage } = await load("ui/start-page.tsx");

const stub = actions as Record<string, unknown>;
const snapshot = useSnapshot() as { paused: boolean };
const ok = { ok: true as const, id: "x" };
const KEYS = ["create", "update", "remove", "restore", "many", "setSetting"];
const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setImmediate(resolve));
};

let writes: string[] = [];
let announced!: { mock: { callCount: () => number; restore: () => void } };

const around = (t: { after: (fn: () => void) => void }, paused: boolean) => {
  const globals = globalThis as Record<string, unknown>;
  Object.assign(globals, {
    location: { hash: "" },
    HTMLElement: class {},
    window: { visualViewport: null },
    innerWidth: 390,
    innerHeight: 800,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    document: { querySelector: () => null, addEventListener: () => undefined, removeEventListener: () => undefined, documentElement: { clientWidth: 390, style: { getPropertyValue: () => "x", setProperty: () => undefined, removeProperty: () => undefined } } },
  });
  Object.assign(timers, { running: () => [], keep: () => undefined, read: () => null, write: () => undefined });
  writes = [];
  announced = mock.method(overlay, "announce");
  snapshot.paused = paused;
  for (const key of KEYS) stub[key] = async () => (writes.push(key), ok);
  mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.parse("2026-10-27T05:00:00Z") });
  t.after(() => {
    mock.timers.reset();
    announced.mock.restore();
    snapshot.paused = false;
    for (const key of ["location", "document", "HTMLElement", "window", "innerWidth", "innerHeight", "addEventListener", "removeEventListener"]) delete globals[key];
    overlay.dismissToast();
    for (const key of ["running", "keep", "read", "write"]) delete (timers as Record<string, unknown>)[key];
    for (const key of KEYS) delete stub[key];
    stage([]);
  });
};

const routine = () => item({ kind: "routine", status: null, who: "a", title: "Morning care", group_key: "morning", data: {} });

const child = (parent: ItemRow, kind: string, title: string, fields: Partial<ItemRow> = {}) => item({ kind, status: null, parent_id: parent.id, title, ...fields });

type Case = { timer?: "running" | "ended"; name: string; rows: (parent: ItemRow) => ItemRow[]; pick: (props: any) => boolean; fire: "onClick" | "onChange" };

const button = (label: string) => (props: any) => props.type === "button" && String(props.children) === label;

const cases: Case[] = [
  { name: "Finish on a step", rows: (parent) => [child(parent, "step", "Cleanse")], pick: button(text.routines.start.finish), fire: "onClick" },
  { name: "Done on a step with more after it", rows: (parent) => [child(parent, "step", "Cleanse"), child(parent, "step", "Tone")], pick: button(text.routines.start.done), fire: "onClick" },
  { name: "a counter's plus", rows: (parent) => [child(parent, "counter", "Water", { qty: 3, data: null })], pick: (props) => props["aria-label"] === text.routines.plus("Water"), fire: "onClick" },
  { name: "a pack item's tick", rows: (parent) => [child(parent, "pack", "Keys"), child(parent, "pack", "Wallet")], pick: (props) => props.type === "checkbox", fire: "onChange" },
  { name: "Finish on a timer that has not started", rows: (parent) => [child(parent, "timer", "Rinse", { data: { minutes: 2 } })], pick: (props) => props.type === "button" && String(props.children) === text.routines.start.finish && String(props.className ?? "").includes("secondary"), fire: "onClick" },
  { timer: "running", name: "Finish on a running timer", rows: (parent) => [child(parent, "timer", "Rinse", { data: { minutes: 2 } })], pick: (props) => props.type === "button" && String(props.children) === text.routines.start.finish && String(props.className) === "start-main", fire: "onClick" },
  { timer: "ended", name: "Finish on a timer that ran out", rows: (parent) => [child(parent, "timer", "Rinse", { data: { minutes: 2 } })], pick: (props) => props.type === "button" && String(props.children) === text.routines.start.finish && String(props.className) === "start-main", fire: "onClick" },
];

for (const paused of [true, false]) {
  for (const one of cases) {
    test(`views/routine-start.tsx: ${one.name} ${paused ? "writes nothing, prints no error, announces the pause and stays aria-disabled while paused" : "still writes when live"}`, async (t) => {
      around(t, paused);
      const parent = routine();
      stage([parent, ...one.rows(parent)]);
      if (one.timer) (timers as Record<string, unknown>).read = () => begin(2, Date.now() - (one.timer === "ended" ? 180_000 : 0));
      const view = mount<Record<string, any>>(RoutineStart, { id: parent.id });
      const session = find(view.tree as never, (_, type) => (type as { name?: string }).name === "Session")[0];
      assert.ok(session, "Session");
      const inner = mount<Record<string, any>>(session.type as never, session.props);
      const shown = find(inner.tree as never, (_, type) => type === StartPage)[0];
      assert.ok(shown, "StartPage");
      const page = mount<Record<string, any>>(StartPage, shown.props);
      const timing = find(page.tree as never, (_, type) => (type as { name?: string }).name === "Timing")[0];
      const body = timing ? mount<Record<string, any>>(timing.type as never, timing.props) : page;
      const control = find(body.tree as never, one.pick)[0] as ReactElement<any>;
      assert.ok(control, "control not found");
      assert.equal(control.props["aria-disabled"], paused ? true : undefined);
      assert.equal(control.props.disabled === true, false);
      await control.props[one.fire]({ preventDefault: () => undefined, target: { checked: true } });
      await settle();
      const errors = find(inner.tree as never, (props) => props.role === "alert" && props.className === "error").length;
      if (paused) assert.deepEqual([writes, errors, announced.mock.callCount(), overlay.getSnapshot().toast?.message], [[], 0, 1, text.pausedTap]);
      else assert.deepEqual([writes.length > 0, errors, overlay.getSnapshot().toast?.message === text.pausedTap], [true, 0, false]);
    });
  }
}

for (const paused of [true, false]) {
  test(`views/routine-start.tsx: ${paused ? "a paused Start page shows the pause note the controls point at" : "a live Start page shows no note"}`, async (t) => {
    around(t, paused);
    const parent = routine();
    stage([parent, child(parent, "step", "Cleanse")]);
    const view = mount<Record<string, any>>(RoutineStart, { id: parent.id });
    const session = find(view.tree as never, (_, type) => (type as { name?: string }).name === "Session")[0];
    const inner = mount<Record<string, any>>(session.type as never, session.props);
    const note = find(inner.tree as never, (_, type) => (type as { name?: string }).name === "PausedNote");
    assert.equal(note.length, 1);
    const shown = mount<Record<string, any>>(note[0].type as never, note[0].props);
    assert.equal(find(shown.tree as never, (props) => props.id === "paused-note").length, paused ? 1 : 0);
  });
}

for (const paused of [true, false]) {
  test(`ui/start-page.tsx: Next on a finished step ${paused ? "stays a plain button while paused" : "is a plain button when live"}, since it writes nothing`, async (t) => {
    around(t, paused);
    const parent = routine();
    stage([parent, child(parent, "step", "Cleanse"), child(parent, "step", "Tone")]);
    const view = mount<Record<string, any>>(RoutineStart, { id: parent.id });
    const session = find(view.tree as never, (_, type) => (type as { name?: string }).name === "Session")[0];
    const inner = mount<Record<string, any>>(session.type as never, session.props);
    const shown = find(inner.tree as never, (_, type) => type === StartPage)[0];
    const finished = child(parent, "step", "Cleanse", { data: { done_a: shown.props.day } });
    const page = mount<Record<string, any>>(StartPage, { ...shown.props, page: [finished] });
    const next = find(page.tree as never, (props) => props.type === "button" && String(props.children) === text.routines.start.next)[0] as ReactElement<any>;
    assert.equal(next.props["aria-disabled"], undefined);
    next.props.onClick();
    await settle();
    assert.deepEqual([writes, announced.mock.callCount()], [[], 0]);
  });
}
