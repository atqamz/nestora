import { useSyncExternalStore } from "react";
import type { Field, Kind } from "../domain/draft.ts";
import type { Found } from "../domain/openlibrary.ts";

export type SheetDraft = { input: string; kindPick: Kind | null; ignore: Field[]; edits: Record<string, string>; ownerPick: string | null };

export type BookDraft = {
  kind: "shelf" | "wish";
  title: string;
  author: string;
  original: string;
  isbn: string;
  language: string;
  blurb: string;
  found: Found | null;
  ownerPick: string | null;
  placePick: string | null;
};

export type Onward = "routine" | "movie" | "series";

export type Compose = { kind: Onward; title: string };

export type ToastAction = { label: string; run: () => void };

type State = { adding: boolean; preset: Kind | Onward | null; compose: Compose | null; session: number; toast: { id: number; message: string; action?: ToastAction; top?: true } | null };

const TOAST_MS = 6000;
const TOAST_ACTION_MS = 12000;

let state: State = { adding: false, preset: null, compose: null, session: 0, toast: null };
let opener: HTMLElement | null = null;
let onward: Compose | null = null;
let onwardAt = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let toasts = 0;
let kept: SheetDraft | null = null;
let keptBook: BookDraft | null = null;
const listeners = new Set<() => void>();

const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

export const overlay = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  getSnapshot: () => state,
  openAdd: (preset: Kind | Onward | null = null) => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onward = null;
    set({ adding: true, preset, session: state.session + 1 });
  },
  closeAdd: () => set({ adding: false }),
  handOff: (next: Compose) => {
    onward = next;
    onwardAt = location.hash;
    set({ adding: false });
  },
  landOnward: () => {
    const next = onward;
    onward = null;
    if (next && location.hash === onwardAt) set({ compose: next });
  },
  closeCompose: () => set({ compose: null }),
  keepDraft: (draft: SheetDraft | null) => {
    kept = draft;
  },
  keptDraft: () => kept,
  keepBook: (draft: BookDraft | null) => {
    keptBook = draft;
  },
  keptBook: () => keptBook,
  returnFocus: () => {
    const target = opener?.isConnected ? opener : document.querySelector<HTMLElement>("h1");
    opener = null;
    target?.focus({ preventScroll: true });
  },
  announce: (message: string, action?: ToastAction, top?: true) => {
    clearTimeout(timer);
    set({ toast: { id: ++toasts, message, action, top } });
    timer = setTimeout(() => set({ toast: null }), action ? TOAST_ACTION_MS : TOAST_MS);
  },
  dismissToast: () => {
    clearTimeout(timer);
    set({ toast: null });
  },
};

export const useOverlay = () => useSyncExternalStore(overlay.subscribe, overlay.getSnapshot);
