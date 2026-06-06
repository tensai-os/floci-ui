import { SignJWT, jwtVerify } from "jose";

const JWT_ALG = "HS256";
const EXP = "7d";

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be set and at least 32 characters for HS256",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(EXP)
    .sign(getSecretKey());
}

export async function verifyAccessToken(
  token: string,
): Promise<{ sub: string }> {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    algorithms: [JWT_ALG],
  });
  const sub = payload.sub;
  if (!sub) throw new Error("Invalid token");
  return { sub };
}
