import { test } from "node:test";
import assert from "node:assert/strict";
import { menuAnchor, menuSpace } from "../src/domain/menu.ts";
import { find, mount } from "./mount.ts";
import { load } from "./render.ts";

const { Menu } = await load("ui/menu.tsx");

type Rect = { top: number; bottom: number; right: number };

const run = () => undefined;
const entries = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item${index}`, icon: "copy", label: `Item ${index}`, run }));

const world = (t: { after: (fn: () => void) => void }, size: { width: number; height: number }) => {
  const globals = globalThis as Record<string, unknown>;
  const listeners = new Map<string, Set<() => void>>();
  const view = { ...size };
  Object.assign(globals, {
    getComputedStyle: () => ({ fontSize: "16px" }),
    addEventListener: (type: string, listener: () => void) => (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener),
    removeEventListener: (type: string, listener: () => void) => listeners.get(type)?.delete(listener),
  });
  Object.defineProperty(globals, "innerWidth", { configurable: true, get: () => view.width });
  Object.defineProperty(globals, "innerHeight", { configurable: true, get: () => view.height });
  Object.assign(globals, { document: { documentElement: {} } });
  t.after(() => {
    for (const key of ["getComputedStyle", "addEventListener", "removeEventListener", "innerWidth", "innerHeight", "document"]) delete globals[key];
  });
  return {
    view,
    count: (type: string) => listeners.get(type)?.size ?? 0,
    emit: (type: string) => listeners.get(type)?.forEach((listener) => listener()),
  };
};

const shown = (menu: ReturnType<typeof mount>) => {
  const [sheet] = find(menu.tree as never, (props) => props.className === "menu-sheet");
  return sheet as { props: { style: Record<string, string>; onClose: () => void } } | undefined;
};

const setup = (t: { after: (fn: () => void) => void }, rect: Rect, size: { width: number; height: number }, count = 3) => {
  const env = world(t, size);
  const menu = mount<Record<string, any>>(Menu, { name: "More actions", items: entries(count) });
  const [button] = find(menu.tree as never, (props) => props["aria-haspopup"] === "menu");
  const more = { rect, getBoundingClientRect: () => more.rect, parentElement: { getBoundingClientRect: () => ({ top: 0, bottom: 5000, right: 5000 }) } };
  Object.assign(button.props.ref.current, more);
  return { env, menu, more, open: () => button.props.onClick({ currentTarget: more }) };
};

const button = { top: 224, bottom: 272, right: 980 };

test("opening anchors the popover from the More button's own rectangle", (t) => {
  const { menu, open } = setup(t, button, { width: 1280, height: 900 });
  assert.equal(shown(menu), undefined);
  open();
  assert.deepEqual(shown(menu)!.props.style, { "--menu-top": "272px", "--menu-room": "628px", "--menu-right": "300px" });
});

test("a window height where the room below is short of the menu and the margin the stylesheet keeps flips the popover upward", (t) => {
  const { menu, open } = setup(t, button, { width: 1280, height: 480 });
  open();
  assert.deepEqual(shown(menu)!.props.style, { "--menu-bottom": "256px", "--menu-room": "224px", "--menu-right": "300px" });
});

test("the popover follows a shrinking window while it is open, without closing the menu", (t) => {
  const { env, menu, open } = setup(t, button, { width: 1280, height: 900 });
  open();
  env.view.height = 400;
  env.emit("resize");
  assert.deepEqual(shown(menu)!.props.style, { "--menu-bottom": "176px", "--menu-room": "224px", "--menu-right": "300px" });
  env.view.height = 900;
  env.emit("resize");
  assert.deepEqual(shown(menu)!.props.style, { "--menu-top": "272px", "--menu-room": "628px", "--menu-right": "300px" });
});

test("the popover is placed again at the button's new position when the window widens past the sheet breakpoint", (t) => {
  const { env, menu, more, open } = setup(t, { top: 224, bottom: 272, right: 780 }, { width: 800, height: 900 });
  open();
  assert.equal(shown(menu)!.props.style["--menu-right"], "20px");
  env.view.width = 1280;
  more.rect = button;
  env.emit("resize");
  assert.equal(shown(menu)!.props.style["--menu-right"], "300px");
  assert.ok(shown(menu));
});

test("the resize listener exists only while the menu is open", (t) => {
  const { env, menu, open } = setup(t, button, { width: 1280, height: 900 });
  assert.equal(env.count("resize"), 0);
  open();
  assert.equal(env.count("resize"), 1);
  env.view.height = 400;
  env.emit("resize");
  assert.equal(env.count("resize"), 1);
  shown(menu)!.props.onClose();
  assert.equal(shown(menu), undefined);
  assert.equal(env.count("resize"), 0);
});

test("a resize while open measures the menu with the item count it has now", (t) => {
  const low = { top: 400, bottom: 448, right: 980 };
  const { env, menu, open } = setup(t, low, { width: 1280, height: 700 });
  open();
  assert.ok("--menu-top" in shown(menu)!.props.style);
  menu.update({ items: entries(5) });
  env.emit("resize");
  assert.deepEqual(shown(menu)!.props.style, menuAnchor(low, { width: 1280, height: 700 }, menuSpace(5, 16)));
  assert.ok("--menu-bottom" in shown(menu)!.props.style);
});
