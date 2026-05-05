import { META_API_VERSION, type MetaAdAccount } from "./oauth";

interface AdAccountsResponse {
  data: MetaAdAccount[];
  paging?: {
    cursors: { before: string; after: string };
    next?: string;
  };
}

export async function getAdAccounts(
  accessToken: string
): Promise<MetaAdAccount[]> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts`;
  const params = new URLSearchParams({
    fields: "id,name,account_status,currency,timezone_name",
    access_token: accessToken,
    limit: "100",
  });

  const response = await fetch(`${url}?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch ad accounts: ${response.status} ${errorText}`
    );
  }

  const result = (await response.json()) as AdAccountsResponse;
  return result.data;
}

export async function getMetaUserInfo(
  accessToken: string
): Promise<{ id: string; name: string }> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/me`;
  const params = new URLSearchParams({
    fields: "id,name",
    access_token: accessToken,
  });

  const response = await fetch(`${url}?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch user info: ${response.status} ${errorText}`
    );
  }

  return response.json() as Promise<{ id: string; name: string }>;
}
