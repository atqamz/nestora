import { useState } from "react";
import { heldOffer } from "../domain/routine-start.ts";
import type { Offer } from "../domain/routine-start.ts";

export const useHeld = (now: Offer | null, release: boolean, day: string) => {
  const [held, setHeld] = useState({ day, offer: now });
  const offer = heldOffer(now, held.day === day ? held.offer : null, release);
  if (held.day !== day || held.offer !== offer) setHeld({ day, offer });
  return offer;
};
