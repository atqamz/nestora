import { useState } from "react";
import type { Side } from "../../shared/api.ts";
import { photoSource } from "../domain/photo.ts";
import { usePartner } from "../hooks/use-plan.ts";

const initials = (name: string) => {
  const [first = "", second = ""] = Array.from(name.trim());
  return `${first.toUpperCase()}${second.toLowerCase()}`;
};

export function Avatar({ side, size = 20 }: { side: Side | null; size?: number }) {
  const { label, photo } = usePartner();
  const src = photoSource(photo(side), size);
  const [seen, setSeen] = useState<{ src: string; ok: boolean } | null>(null);
  const state = src !== null && seen?.src === src ? seen.ok : undefined;
  return (
    <span className="av" data-side={side ?? "none"} data-photo={state ? "ready" : undefined} aria-hidden="true">
      {side === null ? null : initials(label(side))}
      {src !== null && state !== false && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setSeen({ src, ok: true })}
          onError={() => setSeen({ src, ok: false })}
        />
      )}
    </span>
  );
}

export function Pair({ size }: { size?: number }) {
  return (
    <span className="avs">
      <Avatar side="a" size={size} />
      <Avatar side="b" size={size} />
    </span>
  );
}

export function Who({ side }: { side: string | null }) {
  const { label } = usePartner();
  return (
    <span className="who">
      {side === "both" ? <Pair /> : <Avatar side={side === "a" || side === "b" ? side : null} />}
      {label(side)}
    </span>
  );
}
