import type { ReactNode } from "react";

export function Title({ children, className, name }: { children: ReactNode; className?: string; name?: string }) {
  return (
    <h1 tabIndex={-1} className={className} data-title={name}>
      {children}
    </h1>
  );
}
