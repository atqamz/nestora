import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";
import type { Side } from "../shared/api.ts";

export type AuthEnv = {
  AUTH_MODE?: string;
  DEV_WHO?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOWED_EMAILS?: string;
};

export const createAuthenticator = (fetcher?: typeof fetch) => {
  const keys = new Map<string, JWTVerifyGetKey>();
  return async (request: Request, env: AuthEnv, onVerified?: (payload: JWTPayload) => void): Promise<Side | null> => {
    if (env.AUTH_MODE === "dev") return env.DEV_WHO === "a" || env.DEV_WHO === "b" ? env.DEV_WHO : null;
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    const { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: audience } = env;
    const pair = (env.ALLOWED_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase());
    if (!token || !domain || !audience || pair.length !== 2 || pair.some((email) => email === "")) return null;
    try {
      const issuer = `https://${domain}`;
      let getKey = keys.get(issuer);
      if (!getKey) {
        getKey = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), fetcher ? { [customFetch]: fetcher } : {});
        keys.set(issuer, getKey);
      }
      const { payload } = await jwtVerify(token, getKey, { issuer, audience, algorithms: ["RS256"], requiredClaims: ["exp"] });
      const position = typeof payload.email === "string" ? pair.indexOf(payload.email.toLowerCase()) : -1;
      const side = position === 0 ? "a" : position === 1 ? "b" : null;
      if (side !== null) onVerified?.(payload);
      return side;
    } catch {
      return null;
    }
  };
};
