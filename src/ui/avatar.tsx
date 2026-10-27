import { useState } from "react";
import type { Side } from "../../shared/api.ts";
import { photoSource } from "../domain/photo.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { Icon } from "./icons.tsx";

const initials = (name: string) => {
  const [first = "", second = ""] = Array.from(name.trim());
  return `${first.toUpperCase()}${second.toLowerCase()}`;
};

const loaded = new Set<string>();

export function Avatar({ side, size = 20 }: { side: Side | null; size?: number }) {
  const { nickname, photo } = usePartner();
  const name = nickname(side);
  const src = photoSource(photo(side), size);
  const [seen, setSeen] = useState<{ src: string; ok: boolean } | null>(null);
  const state = src === null ? undefined : seen?.src === src ? seen.ok : loaded.has(src) || undefined;
  return (
    <span className="av" data-side={side ?? "none"} data-photo={state ? "ready" : undefined} aria-hidden="true">
      {side === null ? null : name === null ? <Icon name="person" /> : initials(name)}
      {src !== null && state !== false && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => {
            loaded.add(src);
            setSeen({ src, ok: true });
          }}
          onError={() => {
            loaded.delete(src);
            setSeen({ src, ok: false });
          }}
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
