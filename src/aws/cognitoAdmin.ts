import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
  ListUsersCommand,
  ListUsersCommandOutput,
  UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { getAppSecrets } from "./getAppSecrets";

let client: CognitoIdentityProviderClient | null = null;

function getClient(): CognitoIdentityProviderClient {
  if (!client) {
    client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
  }
  return client;
}

/**
 * Deletes a Cognito user by sub. Looks the user up by `sub` attribute first
 * because AdminDeleteUser requires the username (which for our pool is the
 * email). Returns true if a user was found and deleted, false otherwise.
 * Throws on AWS-level errors.
 */
export async function deleteCognitoUserBySub(sub: string): Promise<boolean> {
  const secrets = await getAppSecrets();
  const userPoolId = secrets.COGNITO_USER_POOL_ID;
  const c = getClient();

  const list = await c.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `sub = "${sub}"`,
      Limit: 1,
    })
  );

  const username = list.Users?.[0]?.Username;
  if (!username) return false;

  await c.send(
    new AdminDeleteUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    })
  );
  return true;
}

export interface CognitoUserSummary {
  username: string;
  sub: string;
  email: string | null;
  createdAt: Date | null;
}

/**
 * Lists every user in the Cognito user pool, paginating until exhausted.
 * Used by the orphan sweep to find Cognito users who never finished /register.
 */
export async function listAllCognitoUsers(): Promise<CognitoUserSummary[]> {
  const secrets = await getAppSecrets();
  const userPoolId = secrets.COGNITO_USER_POOL_ID;
  const c = getClient();

  const collected: CognitoUserSummary[] = [];
  let paginationToken: string | undefined = undefined;

  do {
    const response: ListUsersCommandOutput = await c.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Limit: 60,
        PaginationToken: paginationToken,
      })
    );

    for (const u of response.Users ?? []) {
      collected.push(toSummary(u));
    }

    paginationToken = response.PaginationToken;
  } while (paginationToken);

  return collected;
}

function toSummary(u: UserType): CognitoUserSummary {
  let sub = "";
  let email: string | null = null;
  for (const a of u.Attributes ?? []) {
    if (a.Name === "sub" && a.Value) sub = a.Value;
    if (a.Name === "email" && a.Value) email = a.Value;
  }
  return {
    username: u.Username ?? "",
    sub,
    email,
    createdAt: u.UserCreateDate ?? null,
  };
}

/** Test-only — clears the cached client so a fresh region/region read happens. */
export function _resetCognitoAdminClient(): void {
  client = null;
}
