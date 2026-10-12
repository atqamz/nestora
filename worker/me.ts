import type { JWTPayload } from "jose";
import { isPhoto } from "../shared/validate.ts";
import type { AuthEnv } from "./auth.ts";

const IDENTITY_TIMEOUT_MS = 3000;

const pictureOf = (custom: unknown): unknown =>
  typeof custom === "object" && custom !== null && "picture" in custom ? custom.picture : undefined;

const cookieOf = (request: Request, name: string) => {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
};

const identityPicture = async (request: Request, domain: string, fetcher: typeof fetch) => {
  const cookie = cookieOf(request, "CF_Authorization");
  if (cookie === "") return undefined;
  try {
    const res = await fetcher(`https://${domain}/cdn-cgi/access/get-identity`, {
      headers: { cookie: `CF_Authorization=${cookie}` },
      redirect: "manual",
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    });
    return res.status === 200 ? pictureOf(((await res.json()) as { custom?: unknown } | null)?.custom) : undefined;
  } catch {
    return undefined;
  }
};

export const photoOf = async (request: Request, env: AuthEnv, payload: JWTPayload | null, fetcher: typeof fetch) => {
  if (env.AUTH_MODE === "dev") return null;
  const claimed = pictureOf(payload?.custom);
  const picture = claimed !== undefined ? claimed : env.ACCESS_TEAM_DOMAIN ? await identityPicture(request, env.ACCESS_TEAM_DOMAIN, fetcher) : undefined;
  return isPhoto(picture) ? picture : null;
};
