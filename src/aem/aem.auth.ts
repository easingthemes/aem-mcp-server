const IMS_URL = "https://ims-na1.adobelogin.com/ims/token"; // Change region if needed
const SCOPES = "openid,AdobeID,read_organizations,additional_info.projectedProductContext,aem_author_read,aem_author_write";

type AccessTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type?: string;
}

const getScopes = (scopes?: string | string[]): string => {
  if (!scopes) {
    return SCOPES;
  }
  if (Array.isArray(scopes)) {
    return scopes.join(',');
  }
  return scopes;
}

/**
 * Get access token using client credentials (server-to-server OAuth)
 */
export async function getAccessToken(clientId: string, clientSecret: string, scopes?: string | string[]): Promise<AccessTokenResponse> {
  if (!clientId || !clientSecret) {
    throw new Error("Client ID and Client Secret must be provided");
  }
  const scope = getScopes(scopes);
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope,
  });

  const res = await fetch(IMS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`IMS token request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
