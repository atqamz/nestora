export const swallowClicks = (target: EventTarget, ms: number) => {
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  target.addEventListener("click", stop, true);
  setTimeout(() => target.removeEventListener("click", stop, true), ms);
};
