export const HELD_MS = 200;

export const press = (target: EventTarget | null) => {
  const control = target instanceof Element ? target.closest<HTMLElement>("button, a, label") : null;
  if (control === null) return;
  control.dataset.held = "";
  setTimeout(() => delete control.dataset.held, HELD_MS);
};
