#!/usr/bin/env node
/**
 * Exercises makeCertFetch() directly against the mTLS stub — no MCP server, no
 * AEMFetch, no connector. If this passes, the transport itself is sound and any
 * later failure is in the wiring.
 *
 * Covers what the hermetic suite cannot: a real TLS handshake, and that the
 * adapter returns a genuine global Response.
 *
 *   bash test/manual/gen-certs.sh
 *   node test/manual/mtls-server.mjs     # in another terminal
 *   npm run build:ts
 *   node test/manual/smoke-cert-fetch.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCertFetch } from '../../dist/aem/aem.cert-fetch.js';

const CERTS = join(dirname(fileURLToPath(import.meta.url)), 'certs');
const BASE = `https://localhost:${process.env.PORT || 14502}`;

const material = {
  cert: readFileSync(join(CERTS, 'client.pem'), 'utf8'),
  key: readFileSync(join(CERTS, 'client.key'), 'utf8'),
  ca: readFileSync(join(CERTS, 'ca.pem'), 'utf8'),
};

const certFetch = makeCertFetch(material);

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${error.message}`);
    process.exitCode = 1;
  }
}

console.log(`Smoke-testing makeCertFetch against ${BASE}\n`);

await check('GET returns a usable Response', async () => {
  const res = await certFetch(`${BASE}/hello`);
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const parsed = JSON.parse(await res.text());
  assert.equal(parsed.clientCN, 'test-client', 'the handshake must present our certificate');
  assert.equal(parsed.method, 'GET');
});

await check('clone() works before the body is read', async () => {
  const res = await certFetch(`${BASE}/hello`);
  const copy = res.clone();
  const a = await res.text();
  const b = await copy.text();
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

await check('POST preserves body and Content-Type', async () => {
  const payload = JSON.stringify({ hello: 'world', n: 42 });
  const res = await certFetch(`${BASE}/content/x`, {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json' },
  });
  const parsed = JSON.parse(await res.text());
  assert.equal(parsed.method, 'POST');
  assert.equal(parsed.body, payload, 'body must arrive byte-identical');
  assert.equal(parsed.contentType, 'application/json');
});

await check('URLSearchParams body is form-encoded', async () => {
  const params = new URLSearchParams({ ':operation': 'import', name: 'x y' });
  const res = await certFetch(`${BASE}/sling`, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const parsed = JSON.parse(await res.text());
  assert.equal(parsed.body, params.toString());
});

await check('Authorization travels alongside the certificate', async () => {
  const res = await certFetch(`${BASE}/hello`, {
    headers: { Authorization: 'Basic YWRtaW46YWRtaW4=' },
  });
  const parsed = JSON.parse(await res.text());
  assert.equal(parsed.clientCN, 'test-client');
  assert.equal(parsed.authorization, 'Basic <redacted>', 'both must be present at once');
});

await check('204 yields a null body rather than throwing', async () => {
  const res = await certFetch(`${BASE}/_204`);
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
  assert.equal(await res.text(), '');
});

await check('302 is not auto-followed and exposes Location', async () => {
  // request() at aem.fetch.ts:183-192 follows this manually; the transport must
  // surface the header rather than swallow the redirect.
  const res = await certFetch(`${BASE}/_redirect`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/_redirected');
});

await check('an aborted request rejects', async () => {
  const controller = new AbortController();
  const pending = certFetch(`${BASE}/hello`, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /abort/i);
});

await check('an already-aborted signal rejects immediately', async () => {
  await assert.rejects(
    certFetch(`${BASE}/hello`, { signal: AbortSignal.abort() }),
    /abort/i,
  );
});

await check('an unsupported body type is refused loudly', async () => {
  await assert.rejects(
    certFetch(`${BASE}/hello`, { method: 'POST', body: { plain: 'object' } }),
    /Unsupported request body/,
  );
});

await check('200 sequential calls all succeed without exhausting sockets', async () => {
  // Note this does NOT prove pooling from inside the process: a keep-alive agent
  // unrefs its free sockets, so process._getActiveHandles() reports zero whether
  // pooling works or not. What it does prove is that 200 calls in a row keep
  // succeeding — a leak shows up as EMFILE or a stall well before that.
  //
  // For the actual descriptor count, measure from outside while this runs:
  //   lsof -p <pid> | grep -c 14502
  // Measured at a steady 1 socket across 600 calls.
  for (let i = 0; i < 200; i += 1) {
    const res = await certFetch(`${BASE}/hello`);
    assert.equal(res.status, 200, `call ${i + 1} of 200 failed`);
    await res.text();
  }
});

console.log(`\n${passed} check(s) passed${process.exitCode ? ', with failures above' : ''}`);
process.exit(process.exitCode || 0);
