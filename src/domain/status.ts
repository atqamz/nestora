export type Screen = "loading" | "signin" | "connect" | "app";

export const screenFor = ({ ready, me, link }: { ready: boolean; me: string | null; link: Health["link"] }): Screen =>
  !ready ? "loading" : me !== null ? "app" : link === "expired" ? "signin" : "connect";

export type Badge = "storage" | "login" | "mismatch" | "paused" | "rejected" | "offline" | "pending" | "synced";

export type Health = {
  storage: "ok" | "failed";
  link: "online" | "offline" | "expired" | "mismatch";
  rejected: number;
  pending: number;
  paused: boolean;
};

export const badgeFor = ({ storage, link, rejected, pending, paused }: Health): Badge =>
  storage === "failed"
    ? "storage"
    : link === "mismatch"
      ? "mismatch"
      : link === "expired"
        ? "login"
        : paused
          ? "paused"
          : rejected > 0
            ? "rejected"
            : link === "offline"
              ? "offline"
              : pending > 0
                ? "pending"
                : "synced";
