import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Imports the compiled output so the suite runs on plain Node (no TS loader).
// `npm test` builds first; CI builds before the test step.
import {
  loadCertMaterial,
  assertCertHosts,
} from '../dist/aem/aem.cert-fetch.js';

// These units cover every failure path plus the "cert mode off" contract. The
// success path of loadCertMaterial needs a genuine cert/key pair, which cannot be
// produced hermetically (committed fixtures expire, and openssl is not portable
// across CI images) — it is covered by test/manual instead.

const PASSPHRASE_ENV = 'AEM_KEY_PASSPHRASE';

/** Write PEM-ish files into a throwaway dir; returns paths plus a cleanup fn. */
function withFiles(files) {
  const dir = mkdtempSync(join(tmpdir(), 'aem-cert-test-'));
  const paths = {};
  for (const [name, contents] of Object.entries(files)) {
    paths[name] = join(dir, name);
    writeFileSync(paths[name], contents);
  }
  return { dir, paths, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const A_PEM = '-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----\n';
const A_KEY = '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----\n';
const ENCRYPTED_KEY = '-----BEGIN ENCRYPTED PRIVATE KEY-----\nZmFrZQ==\n-----END ENCRYPTED PRIVATE KEY-----\n';

/** Stand-in for loaded material; assertCertHosts only checks it for null-ness. */
const MATERIAL = { cert: A_PEM, key: A_KEY };

// --- loadCertMaterial: the "cert mode off" contract -------------------------

test('loadCertMaterial: returns null when nothing is configured', () => {
  assert.equal(loadCertMaterial({}), null);
  assert.equal(loadCertMaterial(), null);
});

test('loadCertMaterial: --ca alone is refused rather than silently ignored', () => {
  assert.throws(
    () => loadCertMaterial({ ca: '/nowhere/ca.pem' }),
    (err) => err.code === 'INVALID_PARAMETERS' && /does not enable/.test(err.message),
  );
});

// --- loadCertMaterial: flag pairing ----------------------------------------

test('loadCertMaterial: --cert without --key throws naming both flags', () => {
  assert.throws(
    () => loadCertMaterial({ cert: '/nowhere/client.pem' }),
    (err) => err.code === 'INVALID_PARAMETERS'
      && /must be provided together/.test(err.message)
      && /only --cert/.test(err.message),
  );
});

test('loadCertMaterial: --key without --cert throws naming both flags', () => {
  assert.throws(
    () => loadCertMaterial({ key: '/nowhere/client.key' }),
    (err) => err.code === 'INVALID_PARAMETERS'
      && /must be provided together/.test(err.message)
      && /only --key/.test(err.message),
  );
});

// --- loadCertMaterial: file and PEM shape ----------------------------------

test('loadCertMaterial: a missing file throws RESOURCE_NOT_FOUND naming flag and path', () => {
  const { paths, cleanup } = withFiles({ 'client.key': A_KEY });
  try {
    assert.throws(
      () => loadCertMaterial({ cert: '/nowhere/client.pem', key: paths['client.key'] }),
      (err) => err.code === 'RESOURCE_NOT_FOUND'
        && /--cert/.test(err.message)
        && /\/nowhere\/client\.pem/.test(err.message),
    );
  } finally {
    cleanup();
  }
});

test('loadCertMaterial: a non-PEM file is rejected on shape', () => {
  const { paths, cleanup } = withFiles({
    'client.pem': 'this is not a certificate\n',
    'client.key': A_KEY,
  });
  try {
    assert.throws(
      () => loadCertMaterial({ cert: paths['client.pem'], key: paths['client.key'] }),
      (err) => err.code === 'INVALID_PARAMETERS' && /not a PEM-encoded file/.test(err.message),
    );
  } finally {
    cleanup();
  }
});

test('loadCertMaterial: leading whitespace does not defeat the PEM check', () => {
  const { paths, cleanup } = withFiles({
    'client.pem': `\n\n  ${A_PEM}`,
    'client.key': A_KEY,
  });
  try {
    // Gets past the shape check and fails later, on the keypair — not on shape.
    assert.throws(
      () => loadCertMaterial({ cert: paths['client.pem'], key: paths['client.key'] }),
      (err) => !/not a PEM-encoded file/.test(err.message),
    );
  } finally {
    cleanup();
  }
});

// --- loadCertMaterial: encrypted keys --------------------------------------

test('loadCertMaterial: encrypted key without a passphrase names the env var', () => {
  const previous = process.env[PASSPHRASE_ENV];
  delete process.env[PASSPHRASE_ENV];
  const { paths, cleanup } = withFiles({
    'client.pem': A_PEM,
    'client.key': ENCRYPTED_KEY,
  });
  try {
    assert.throws(
      () => loadCertMaterial({ cert: paths['client.pem'], key: paths['client.key'] }),
      (err) => err.code === 'INVALID_PARAMETERS'
        && err.message.includes(PASSPHRASE_ENV)
        && /no CLI flag/.test(err.message),
    );
  } finally {
    cleanup();
    if (previous !== undefined) process.env[PASSPHRASE_ENV] = previous;
  }
});

// --- loadCertMaterial: keypair validity ------------------------------------

test('loadCertMaterial: a bogus keypair fails at startup, not at handshake time', () => {
  const { paths, cleanup } = withFiles({
    'client.pem': A_PEM,
    'client.key': A_KEY,
  });
  try {
    assert.throws(
      () => loadCertMaterial({ cert: paths['client.pem'], key: paths['client.key'] }),
      (err) => err.code === 'INVALID_PARAMETERS' && /not a valid keypair/.test(err.message),
    );
  } finally {
    cleanup();
  }
});

// --- assertCertHosts -------------------------------------------------------

test('assertCertHosts: no-op when no certificate is configured', () => {
  // The critical guard: with cert mode off this must never fire, whatever the hosts.
  assert.doesNotThrow(() => assertCertHosts(null, [
    { label: '--host', host: 'http://anything.example' },
    { label: 'legacy', host: 'ftp://weird' },
  ]));
});

test('assertCertHosts: accepts https hosts', () => {
  assert.doesNotThrow(() => assertCertHosts(MATERIAL, [
    { label: '--host', host: 'https://aem.example.com' },
  ]));
});

test('assertCertHosts: rejects a remote plaintext host, naming the label', () => {
  assert.throws(
    () => assertCertHosts(MATERIAL, [{ label: '--host', host: 'http://remote.example' }]),
    (err) => err.code === 'INVALID_PARAMETERS'
      && /--host \(http:\/\/remote\.example\)/.test(err.message),
  );
});

test('assertCertHosts: exempts loopback hosts', () => {
  assert.doesNotThrow(() => assertCertHosts(MATERIAL, [
    { label: 'local', host: 'http://localhost:4502' },
    { label: 'ip', host: 'http://127.0.0.1:4502' },
    { label: 'v6', host: 'http://[::1]:4502' },
    { label: 'bare', host: 'http://localhost' },
  ]));
});

test('assertCertHosts: a lookalike host is not mistaken for loopback', () => {
  assert.throws(
    () => assertCertHosts(MATERIAL, [{ label: 'evil', host: 'http://localhost.evil.com' }]),
    (err) => /evil \(http:\/\/localhost\.evil\.com\)/.test(err.message),
  );
});

test('assertCertHosts: names only the offending instances', () => {
  assert.throws(
    () => assertCertHosts(MATERIAL, [
      { label: 'a', host: 'https://a.example' },
      { label: 'b', host: 'http://b.example' },
      { label: 'c', host: 'http://localhost:4502' },
    ]),
    (err) => /b \(http:\/\/b\.example\)/.test(err.message)
      && !/a \(/.test(err.message)
      && !/c \(/.test(err.message),
  );
});
