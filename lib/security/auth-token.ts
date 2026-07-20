import { getToken } from "next-auth/jwt";

export async function readServerAuthToken(request: Request) {
  const secret = process.env.AUTH_SECRET;
  const cookie = request.headers.get("cookie");
  if (!secret || !cookie) return null;

  const headers = new Headers({ cookie });
  return getToken({
    req: { headers },
    secret,
    secureCookie: cookie.includes("__Secure-authjs.session-token"),
  });
}
