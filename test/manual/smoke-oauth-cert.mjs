#!/usr/bin/env node
/**
 * OAuth S2S + client certificate, end to end through AEMConnector, without real
 * Adobe IMS credentials.
 *
 * The IMS token call (src/aem/aem.auth.ts) uses global fetch; the AEM leg in cert
 * mode uses node:https. So replacing global fetch with a fake IMS answers the
 * token request while every AEM request still makes a real mTLS handshake with
 * the stub. What this cannot prove is that real IMS accepts real credentials —
 * see "TODO — before merging the final PR" in README.md.
 *
 * Start the stub with STUB_BEARER=fake-ims-access-token so it checks the token
 * value, not just the scheme. Without it the value checks are skipped.
 *
 *   bash test/manual/gen-certs.sh
 *   STUB_BEARER=fake-ims-access-token node test/manual/mtls-server.mjs   # another terminal
 *   npm run build:ts
 *   node test/manual/smoke-oauth-cert.mjs
 */

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CERTS = join(dirname(fileURLToPath(import.meta.url)), 'certs');
const HOST = `https://localhost:${process.env.PORT || 14502}`;
const CLIENT_ID = 'fake-client-id';
const FAKE_TOKEN = 'fake-ims-access-token';

// The fake IMS answers from this queue, one entry per token request, and repeats
// the last entry once the queue runs out. Each scenario sets its own.
let imsResponses = [];
const imsCalls = [];
const otherGlobalFetchCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.startsWith('https://ims-na1.adobelogin.com/')) {
    imsCalls.push({ url, body: String(init.body) });
    const next = imsResponses.length > 1 ? imsResponses.shift() : imsResponses[0];
    return next.status === 200
      ? new Response(JSON.stringify({ access_token: next.token, expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      : new Response(JSON.stringify({ error: 'invalid_client' }), { status: next.status });
  }
  otherGlobalFetchCalls.push(url);
  return realFetch(input, init);
};

// Imported after the patch so every module sees the fake.
const { AEMConnector } = await import('../../dist/aem/aem.connector.js');

function newConnector() {
  return new AEMConnector({
    host: HOST,
    id: CLIENT_ID,
    secret: 'fake-client-secret',
    cert: join(CERTS, 'client.pem'),
    key: join(CERTS, 'client.key'),
    ca: join(CERTS, 'ca.pem'),
  });
}

function reset(responses) {
  imsResponses = responses;
  imsCalls.length = 0;
  otherGlobalFetchCalls.length = 0;
}

let passed = 0;
let total = 0;
async function check(name, fn) {
  total += 1;
  try {
    const skipped = await fn();
    if (skipped === 'skip') {
      total -= 1;
      console.log(`  skip  ${name} (stub started without STUB_BEARER)`);
      return;
    }
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- happy path

reset([{ status: 200, token: FAKE_TOKEN }]);
const connector = newConnector();
await connector.init();
const result = await connector.getNodeContent('/content/oauth-cert', 1);
const echo = result?.content ?? {};

await check('connector is in OAuth (AEMaaCS) mode', () => {
  assert.equal(connector.isAEMaaCS, true);
});

await check('token came from IMS via global fetch, exactly once, with our client_id', () => {
  assert.equal(imsCalls.length, 1);
  const body = new URLSearchParams(imsCalls[0].body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), CLIENT_ID);
});

await check('AEM request presented the client certificate (stub saw clientCN)', () => {
  assert.equal(echo.clientCN, 'test-client');
});

await check('AEM request carried Authorization: Bearer', () => {
  assert.match(String(echo.authorization), /^Bearer /);
});

await check('stub accepted the exact token value IMS issued', () => {
  if (echo.auth === 'unchecked') return 'skip';
  assert.equal(echo.auth, 'ok');
});

await check('no AEM request went through global fetch (all used the cert transport)', () => {
  assert.deepEqual(otherGlobalFetchCalls, []);
});

// ---------------------------------------------------------------- IMS rejects

reset([{ status: 401 }]);
await check('IMS rejecting the client credentials fails with the IMS error, no AEM call', async () => {
  const rejected = newConnector();
  await assert.rejects(
    async () => {
      await rejected.init();
      await rejected.getNodeContent('/content/oauth-cert', 1);
    },
    /IMS token request failed: 401/,
  );
  assert.equal(imsCalls.length, 1);
  assert.deepEqual(otherGlobalFetchCalls, []);
});

// ---------------------------------------------------------------- stale token

// AEM answers 401 to a token it no longer accepts; AEMFetch must fetch a fresh
// one from IMS and retry once — over the cert transport, not global fetch.
reset([{ status: 200, token: 'stale-token' }, { status: 200, token: FAKE_TOKEN }]);
await check('401 on a stale token → one IMS refresh → retry succeeds with the new token', async () => {
  const stale = newConnector();
  await stale.init();
  const retried = (await stale.getNodeContent('/content/oauth-cert', 1))?.content ?? {};
  if (retried.auth === 'unchecked') return 'skip';
  assert.equal(imsCalls.length, 2);
  assert.equal(retried.auth, 'ok');
  assert.equal(retried.clientCN, 'test-client');
  assert.deepEqual(otherGlobalFetchCalls, []);
});

console.log(`\n${passed}/${total} passed`);
