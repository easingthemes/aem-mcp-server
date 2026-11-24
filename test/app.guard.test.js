import { test } from 'node:test';
import assert from 'node:assert/strict';
// Imports the compiled output so the suite runs on plain Node (no TS loader).
import {
  refusal,
  isLocalName,
  basicAuthMatches,
  configuredCredentials,
  corsOriginAllowed,
  listenHost,
} from '../dist/server/app.guard.js';

const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const creds = { username: 'mcp-user', password: 'p:ss:word' };

test('no credentials: local clients pass', () => {
  for (const host of ['localhost:8502', '127.0.0.1:8502', '[::1]:8502', 'LOCALHOST:8502']) {
    assert.equal(refusal({ host }), null, host);
  }
  assert.equal(refusal({ host: 'localhost:8502', origin: 'http://localhost:6274' }), null, 'local inspector');
});

test('no credentials: DNS-rebinding and network hosts are refused', () => {
  for (const host of ['attacker.example:8502', '127.0.0.1.attacker.example:8502', '192.168.1.20:8502', '', undefined]) {
    assert.equal(refusal({ host })?.status, 403, String(host));
  }
});

test('no credentials: other web origins are refused', () => {
  for (const origin of ['https://attacker.example', 'null', 'http://192.168.1.20:8502']) {
    assert.equal(refusal({ host: 'localhost:8502', origin })?.status, 403, origin);
  }
});

test('credentials: Basic auth is required from everyone, including localhost', () => {
  const host = 'aem-mcp.example.test';
  assert.equal(refusal({ host, credentials: creds })?.status, 401);
  assert.equal(refusal({ host: 'localhost:8502', credentials: creds })?.status, 401);
  assert.equal(refusal({ host, credentials: creds, authorization: basic('mcp-user', 'wrong') })?.status, 401);
  assert.equal(refusal({ host, credentials: creds, authorization: basic('other', 'p:ss:word') })?.status, 401);
  assert.equal(refusal({ host, credentials: creds, authorization: 'Bearer p:ss:word' })?.status, 401);
  assert.equal(refusal({ host, credentials: creds, authorization: basic('mcp-user', 'p:ss:word') }), null);
});

test('there are no default credentials', () => {
  assert.equal(configuredCredentials('', ''), null);
  assert.equal(configuredCredentials('admin', ''), null);
  assert.equal(configuredCredentials(undefined, 'x'), null);
  assert.deepEqual(configuredCredentials('u', 'p'), { username: 'u', password: 'p' });
  assert.equal(basicAuthMatches(basic('admin', 'admin'), creds), false);
  assert.equal(basicAuthMatches('Basic !!!', creds), false);
  assert.equal(basicAuthMatches(undefined, creds), false);
});

test('CORS only allows pages served from this machine', () => {
  assert.equal(corsOriginAllowed(undefined), true, 'non-browser clients send no Origin');
  assert.equal(corsOriginAllowed('http://localhost:6274'), true);
  assert.equal(corsOriginAllowed('http://127.0.0.1:3000'), true);
  assert.equal(corsOriginAllowed('https://attacker.example'), false);
  assert.equal(corsOriginAllowed('null'), false);
});

test('listens on loopback unless credentials or an explicit host say otherwise', () => {
  assert.equal(listenHost(undefined, null), '127.0.0.1');
  assert.equal(listenHost(undefined, creds), undefined);
  assert.equal(listenHost('0.0.0.0', null), '0.0.0.0');
});

test('isLocalName', () => {
  assert.equal(isLocalName('localhost.attacker.example'), false);
  assert.equal(isLocalName('http://[::1]:8502'), true);
  assert.equal(isLocalName(undefined), false);
});
