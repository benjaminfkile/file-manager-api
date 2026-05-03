import { CognitoJwtVerifier } from "aws-jwt-verify";
import { getAppSecrets } from "./getAppSecrets";

/**
 * Verifies a Cognito ID token and returns the Cognito subject (sub) and email
 * claims. Throws if the token is missing, expired, or invalid.
 */
export async function verifyCognitoToken(token: string): Promise<{ sub: string; email: string | null }> {
  const secrets = await getAppSecrets();

  const verifier = CognitoJwtVerifier.create({
    userPoolId: secrets.COGNITO_USER_POOL_ID,
    clientId: secrets.COGNITO_CLIENT_ID,
    tokenUse: "id",
  });

  const payload = await verifier.verify(token);
  const email = typeof payload.email === "string" ? payload.email : null;
  return { sub: payload.sub, email };
}
