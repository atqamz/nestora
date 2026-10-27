import * as React from "react";
import type { ReactElement, ReactNode } from "react";

const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

export type Spot = { element: ReactElement<any>; focused: number; focus: () => void; querySelector: () => null; contains: () => boolean; showModal: () => void };

export const walk = (node: ReactNode, visit: (element: ReactElement<any>) => void) => {
  if (Array.isArray(node)) node.forEach((child) => walk(child, visit));
  else if (React.isValidElement(node)) {
    visit(node as ReactElement<any>);
    walk((node.props as any).children, visit);
  }
};

export const find = (tree: ReactNode, test: (props: any, type: unknown) => boolean) => {
  const found: ReactElement<any>[] = [];
  walk(tree, (element) => test(element.props, element.type) && found.push(element));
  return found;
};

export const textOf = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(textOf).join("") : React.isValidElement(node) ? textOf((node.props as any).children) : typeof node === "string" || typeof node === "number" ? String(node) : "";

const same = (a: unknown[] | undefined, b: unknown[] | undefined) => a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

export const mount = <P extends object>(component: (props: P) => ReactNode, first: P) => {
  const slots: any[] = [];
  const spots = new Map<object, Spot>();
  const focusLog: Spot[] = [];
  let props = first;
  let tree: ReactNode = null;
  let cursor = 0;
  let dirty = false;
  let flushing = false;
  let ids = 0;
  const dispatcher = {
    useState: (init: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof init === "function" ? (init as () => unknown)() : init };
      const slot = slots[index];
      slot.set ??= (next: unknown) => {
        const value = typeof next === "function" ? (next as (old: unknown) => unknown)(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        dirty = true;
        flush();
      };
      return [slot.value, slot.set];
    },
    useRef: (init: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: init };
      return slots[index];
    },
    useId: () => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { id: `:m${ids++}:` };
      return slots[index].id;
    },
    useMemo: (make: () => unknown, deps: unknown[]) => {
      const index = cursor++;
      if (!(index in slots) || !same(slots[index].deps, deps)) slots[index] = { deps, value: make() };
      return slots[index].value;
    },
    useCallback: (fn: unknown, deps: unknown[]) => dispatcher.useMemo(() => fn, deps),
    useDeferredValue: (value: unknown) => value,
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
    useEffect: (run: () => void | (() => void), deps?: unknown[]) => {
      const index = cursor++;
      const effect = slots[index];
      if (!effect) slots[index] = { deps, run, pending: true };
      else if (!same(effect.deps, deps)) Object.assign(effect, { deps, run, pending: true });
    },
  };
  const render = () => {
    const before = internals.H;
    internals.H = dispatcher;
    try {
      do {
        dirty = false;
        cursor = 0;
        tree = component(props);
      } while (dirty);
    } finally {
      internals.H = before;
    }
  };
  const commit = () => {
    walk(tree, (element) => {
      const ref = element.props.ref;
      if (ref && typeof ref === "object" && !spots.has(ref)) {
        const spot: Spot = { element, focused: 0, focus: () => void (spot.focused++, focusLog.push(spot)), querySelector: () => null, contains: () => false, showModal: () => undefined };
        spots.set(ref, spot);
      }
      if (ref && typeof ref === "object") {
        const spot = spots.get(ref)!;
        spot.element = element;
        ref.current = spot;
      }
    });
    for (const slot of slots) {
      if (slot && "run" in slot && slot.pending) {
        slot.pending = false;
        if (typeof slot.cleanup === "function") slot.cleanup();
        slot.cleanup = slot.run();
      }
    }
  };
  const flush = () => {
    if (flushing) return;
    flushing = true;
    try {
      do {
        render();
        commit();
      } while (dirty);
    } finally {
      flushing = false;
    }
  };
  flush();
  return {
    get tree() {
      return tree;
    },
    focusLog,
    update: (next: Partial<P>) => {
      props = { ...props, ...next };
      dirty = true;
      flush();
    },
  };
};
