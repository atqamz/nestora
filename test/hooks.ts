import * as React from "react";
import type { ReactElement, ReactNode } from "react";

const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

export type Node = { kind: string; element: ReactElement; inside: boolean; contains: (other: unknown) => boolean; focus: () => void };

type Listener = (event: unknown) => void;

export type Dom = { activeElement: unknown; body: unknown; listeners: Map<string, Set<Listener>>; captured: Map<string, boolean>; emit: (type: string) => void };

export const dom = (): Dom => {
  const listeners = new Map<string, Set<Listener>>();
  const captured = new Map<string, boolean>();
  const body = { kind: "body" };
  const fake: Dom & Record<string, unknown> = {
    activeElement: body,
    body,
    listeners,
    captured,
    addEventListener: (type: string, listener: Listener, capture = false) => {
      captured.set(type, capture);
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener);
    },
    removeEventListener: (type: string, listener: Listener, capture = false) => {
      if (captured.get(type) === capture) listeners.get(type)?.delete(listener);
    },
    emit: (type: string) => listeners.get(type)?.forEach((listener) => listener({ type })),
  };
  (globalThis as any).document = fake;
  return fake;
};

export const walk = (node: ReactNode, visit: (element: ReactElement<any>) => void) => {
  if (Array.isArray(node)) node.forEach((child) => walk(child, visit));
  else if (React.isValidElement(node)) {
    visit(node as ReactElement<any>);
    walk((node.props as any).children, visit);
  }
};

export const find = (tree: ReactNode, test: (element: ReactElement<any>) => boolean) => {
  const found: ReactElement<any>[] = [];
  walk(tree, (element) => test(element) && found.push(element));
  return found;
};

export const textOf = (node: ReactNode): string => (Array.isArray(node) ? node.map(textOf).join("") : React.isValidElement(node) ? textOf((node.props as any).children) : typeof node === "string" || typeof node === "number" ? String(node) : "");

type Effect = { deps: unknown[] | undefined; run: () => void | (() => void); cleanup?: void | (() => void); pending: boolean };

export const mount = <P extends object>(component: (props: P) => ReactNode, first: P, document: Dom) => {
  const slots: any[] = [];
  let props = first;
  let tree: ReactNode = null;
  let rendering = false;
  let dirty = false;
  let flushing = false;
  const nodes = new Map<object, Node>();
  const nodeFor = (element: ReactElement<any>): Node => {
    const key = element.props.ref;
    const known = nodes.get(key);
    if (known) return known;
    const node: Node = {
      kind: String(element.type),
      element,
      inside: false,
      contains: (other) => other === node || (node.inside && other !== document.body),
      focus: () => void (document.activeElement = node),
    };
    nodes.set(key, node);
    return node;
  };
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) => a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
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
        if (!rendering) flush();
      };
      return [slot.value, slot.set];
    },
    useRef: (init: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: init };
      return slots[index];
    },
    useMemo: (make: () => unknown, deps: unknown[]) => {
      const index = cursor++;
      if (!(index in slots) || !same(slots[index].deps, deps)) slots[index] = { deps, value: make() };
      return slots[index].value;
    },
    useCallback: (fn: unknown, deps: unknown[]) => dispatcher.useMemo(() => fn, deps),
    useLayoutEffect: (run: () => void | (() => void), deps?: unknown[]) => dispatcher.useEffect(run, deps),
    useEffect: (run: () => void | (() => void), deps?: unknown[]) => {
      const index = cursor++;
      const effect: Effect | undefined = slots[index];
      if (!effect) slots[index] = { deps, run, pending: true };
      else if (!same(effect.deps, deps)) Object.assign(effect, { deps, run, pending: true });
    },
  };
  let cursor = 0;
  const render = () => {
    const before = internals.H;
    internals.H = dispatcher;
    rendering = true;
    try {
      do {
        dirty = false;
        cursor = 0;
        tree = component(props);
      } while (dirty);
    } finally {
      rendering = false;
      internals.H = before;
    }
  };
  const commit = () => {
    walk(tree, (element) => {
      const ref = element.props.ref;
      if (ref && typeof ref === "object") ref.current = nodeFor(element);
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
    nodes,
    update: (next: Partial<P>) => {
      props = { ...props, ...next };
      dirty = true;
      flush();
    },
    node: (kind: string) => [...nodes.values()].find((node) => node.kind === kind || (node.element.props as any).className === kind),
    unmount: () => {
      for (const slot of slots) if (slot && "run" in slot && typeof slot.cleanup === "function") slot.cleanup();
    },
  };
};
