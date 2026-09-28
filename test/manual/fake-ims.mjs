/**
 * Fake Adobe IMS, loaded with `node --import` or a plain import before the AEM
 * modules. Replaces global fetch for IMS URLs only; everything else passes
 * through. Issues token-1, token-2, … so a refresh is visible in the request.
 *
 * FAKE_IMS_STATUS=401 makes every token request fail instead.
 */

const realFetch = globalThis.fetch;
let issued = 0;

globalThis.fetch = async (input, init = {}) => {
  if (!String(input).startsWith('https://ims-na1.adobelogin.com/')) {
    return realFetch(input, init);
  }
  const status = Number(process.env.FAKE_IMS_STATUS || 200);
  if (status !== 200) {
    return new Response(JSON.stringify({ error: 'invalid_client' }), { status });
  }
  issued += 1;
  return new Response(JSON.stringify({ access_token: `token-${issued}`, expires_in: 3600 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const imsTokensIssued = () => issued;
