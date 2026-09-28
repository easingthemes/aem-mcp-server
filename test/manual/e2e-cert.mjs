#!/usr/bin/env node
/**
 * Client certificate support, end to end through the real MCP surface, with no
 * AEM instance and no real credentials.
 *
 * Self-contained: generates certificates if missing, starts its own mTLS stub on
 * a free port, drives dist/cli.js over stdio and HTTP, and stops every child it
 * started (by handle — never by name pattern). Exits 1 if any check fails.
 *
 * The stub stands in for AEM behind an mTLS-terminating Dispatcher, and checks
 * credential values against mock accounts (STUB_BASIC / STUB_BEARER below):
 * anything else gets 401. OAuth is covered by running smoke-oauth-cert.mjs,
 * which fakes IMS and issues the mock Bearer token.
 *
 *   npm run build:ts
 *   node test/manual/e2e-cert.mjs
 *
 * Needs to bind localhost ports, so it will not run inside a network sandbox.
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CERTS = join(HERE, 'certs');
const CLI = join(ROOT, 'dist/cli.js');
const RPC_TIMEOUT_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cert = (name) => join(CERTS, name);
// Mock credentials the stub accepts. Anything else is answered with 401.
const STUB_AUTH = { STUB_BASIC: 'admin:admin,other:secret', STUB_BEARER: 'fake-ims-access-token' };
const CERT_ARGS = ['--cert', cert('client.pem'), '--key', cert('client.key'), '--ca', cert('ca.pem')];

// ---------------------------------------------------------------- bookkeeping

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`);
}

const children = new Set();
function track(child) {
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}
function stopAll() {
  for (const child of children) child.kill();
}
process.on('SIGINT', () => { stopAll(); process.exit(130); });

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer().once('error', rej).listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

// ---------------------------------------------------------------- mTLS stub

async function startStub(port) {
  const child = track(spawn('node', [join(HERE, 'mtls-server.mjs')], { env: { ...process.env, ...STUB_AUTH, PORT: String(port) } }));
  const lines = [];
  let stderr = '';
  child.stdout.on('data', (d) => lines.push(...d.toString().split('\n').filter(Boolean)));
  child.stderr.on('data', (d) => { stderr += d; });

  for (let waited = 0; !lines.some((l) => l.includes('listening')); waited += 50) {
    if (child.exitCode !== null || waited > 5000) {
      throw new Error(`stub did not start: ${stderr.trim() || 'timeout'}`);
    }
    await sleep(50);
  }
  // Log lines appended from now on belong to whichever check took the mark.
  return { child, mark: () => lines.length, since: (m) => lines.slice(m).join('\n') };
}

// ---------------------------------------------------------------- stdio client

function stdioSession(args, env = {}) {
  const child = track(spawn('node', [CLI, '-t', 'stdio', ...args], { env: { ...process.env, ...env } }));
  const stdoutLines = [];
  const waiters = new Map();
  let buf = '';
  let id = 0;

  child.stdout.on('data', (d) => {
    buf += d.toString();
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      stdoutLines.push(line);
      try {
        const msg = JSON.parse(line);
        waiters.get(msg.id)?.(msg);
      } catch { /* non-JSON stdout is itself a failure, asserted by the caller */ }
    }
  });

  const rpc = (method, params) => new Promise((res, rej) => {
    const myId = ++id;
    const timer = setTimeout(() => rej(new Error(`${method} timed out after ${RPC_TIMEOUT_MS}ms`)), RPC_TIMEOUT_MS);
    waiters.set(myId, (msg) => { clearTimeout(timer); res(msg); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: myId, method, params })}\n`);
  });

  const init = async () => {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-cert', version: '0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  };

  const nonJsonStdout = () => stdoutLines.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } });

  return { child, rpc, init, nonJsonStdout };
}

const callNode = (s) => s.rpc('tools/call', { name: 'getNodeContent', arguments: { path: '/content/e2e', depth: 1 } });
const toolText = (r) => r?.result?.content?.[0]?.text ?? JSON.stringify(r?.error ?? r);
const isToolError = (r) => !!r?.result?.isError || !!r?.error || /error|fail/i.test(toolText(r));

// ---------------------------------------------------------------- checks

async function stdioWithCertAndBasic(stub, host) {
  console.log('\nstdio + cert + Basic');
  const m = stub.mark();
  const s = stdioSession(['-H', host, ...CERT_ARGS, '-u', 'admin', '-p', 'admin']);
  await s.init();
  const r = await callNode(s);
  await sleep(200);
  const log = stub.since(m);

  check('stub saw clientCN=test-client', /clientCN=test-client/.test(log), log);
  check('same request carried Authorization: Basic with the right value', /clientCN=test-client .*authorization=Basic <redacted> auth=ok/.test(log), log);
  check('tools/call returned the stub echo', !isToolError(r) && toolText(r).includes('test-client'), toolText(r).slice(0, 200));
  check('stdout carries only JSON-RPC', s.nonJsonStdout().length === 0, s.nonJsonStdout()[0]);

  // Sockets must be reused or released: a leak shows up as a growing fd count.
  let lsofAvailable = true;
  const fds = () => {
    try {
      return execFileSync('lsof', ['-p', String(s.child.pid)]).toString().split('\n').length;
    } catch {
      lsofAvailable = false;
      return 0;
    }
  };
  const before = fds();
  for (let i = 0; i < 200; i++) await callNode(s);
  const after = fds();
  if (lsofAvailable) {
    check('200 calls, fd count flat', after - before <= 2, `before=${before} after=${after}`);
  } else {
    console.log('  skip  200 calls, fd count flat (lsof not available)');
  }
  s.child.kill();
}

async function stdioWithEncryptedKey(stub, host) {
  console.log('\nstdio + cert with encrypted key (AEM_KEY_PASSPHRASE)');
  const m = stub.mark();
  const args = ['-H', host, '--cert', cert('client.pem'), '--key', cert('client.encrypted.key'), '--ca', cert('ca.pem'), '-u', 'admin', '-p', 'admin'];
  const s = stdioSession(args, { AEM_KEY_PASSPHRASE: 'testpass' });
  await s.init();
  const r = await callNode(s);
  await sleep(200);
  check('encrypted key loads and handshake succeeds', /clientCN=test-client/.test(stub.since(m)) && !isToolError(r), toolText(r).slice(0, 200));
  s.child.kill();
}

async function wrongPassword(stub, host) {
  console.log('\nnegative control: valid certificate, wrong Basic password');
  const m = stub.mark();
  const s = stdioSession(['-H', host, ...CERT_ARGS, '-u', 'admin', '-p', 'wrong']);
  await s.init();
  const r = await callNode(s);
  await sleep(200);
  const log = stub.since(m);
  // The handshake succeeds — the cert is fine — and the user is still refused.
  check('handshake succeeded, credentials rejected', /clientCN=test-client .*auth=rejected/.test(log) && !/auth=ok/.test(log), log);
  check('tools/call reports 401', isToolError(r) && /401|Authentication failed/i.test(toolText(r)), toolText(r).slice(0, 200));
  s.child.kill();
}

async function negativeNoCert(stub, host) {
  console.log('\nnegative control: no client certificate');
  const m = stub.mark();
  // Trust the stub's server cert so the only thing missing is the client cert.
  const s = stdioSession(['-H', host, '-u', 'admin', '-p', 'admin'], { NODE_EXTRA_CA_CERTS: cert('ca.pem') });
  await s.init();
  const r = await callNode(s);
  await sleep(200);
  const log = stub.since(m);
  check('stub rejected the handshake', /handshake rejected/.test(log) && !/clientCN=/.test(log), log);
  check('tools/call reports an error', isToolError(r), toolText(r).slice(0, 200));
  s.child.kill();
}

async function negativeUntrustedCert(stub, host) {
  console.log('\nnegative control: client certificate from a different CA');
  const m = stub.mark();
  const args = ['-H', host, '--cert', cert('untrusted-client.pem'), '--key', cert('untrusted-client.key'), '--ca', cert('ca.pem'), '-u', 'admin', '-p', 'admin'];
  const s = stdioSession(args);
  await s.init();
  const r = await callNode(s);
  await sleep(200);
  const log = stub.since(m);
  check('stub rejected the untrusted certificate', !/clientCN=/.test(log), log);
  check('tools/call reports an error', isToolError(r), toolText(r).slice(0, 200));
  s.child.kill();
}

async function httpWithCert(stub, host) {
  console.log('\nhttp + cert (default admin:admin)');
  const port = await freePort();
  const m = stub.mark();
  const srv = track(spawn('node', [CLI, '-H', host, ...CERT_ARGS, '-m', String(port)]));

  const post = async (body, sid) => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sid ? { 'mcp-session-id': sid } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    return { sid: res.headers.get('mcp-session-id'), text: await res.text() };
  };

  // The HTTP server takes a moment to bind; retry the first request only.
  let init;
  for (let attempt = 0; !init; attempt++) {
    try {
      init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-cert', version: '0' } } });
    } catch (error) {
      if (attempt >= 50) throw new Error(`MCP HTTP server did not come up: ${error.message}`);
      await sleep(100);
    }
  }
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.sid);
  const call = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'getNodeContent', arguments: { path: '/content/e2e', depth: 1 } } }, init.sid);
  await sleep(200);
  const log = stub.since(m);

  check('stub saw clientCN and accepted Authorization: Basic', /clientCN=test-client .*authorization=Basic <redacted> auth=ok/.test(log), log);
  check('tools/call answered over POST /mcp', /"result"/.test(call.text) && call.text.includes('test-client'), call.text.slice(0, 200));
  srv.kill();
}

async function redirectInCertMode(stub, host) {
  console.log('\nredirect: one hop in cert mode (AEMFetch)');
  const { AEMFetch } = await import(pathToFileURL(join(ROOT, 'dist/aem/aem.fetch.js')).href);
  const { loadCertMaterial } = await import(pathToFileURL(join(ROOT, 'dist/aem/aem.cert-fetch.js')).href);
  const f = new AEMFetch({
    host,
    auth: { username: 'admin', password: 'admin' },
    cert: loadCertMaterial({ cert: cert('client.pem'), key: cert('client.key'), ca: cert('ca.pem') }),
  });
  await f.init();
  const m = stub.mark();
  const r = await f.get('/_redirect');
  await sleep(200);
  const log = stub.since(m);
  check('302 followed to /_redirected with the client cert and credentials', /clientCN=test-client GET \/_redirected .*auth=ok/.test(log), log);
  check('response is the redirect target', JSON.stringify(r).includes('/_redirected'), JSON.stringify(r).slice(0, 200));
}

/**
 * Misconfiguration must fail at startup, locally, with the flag named — never as
 * an opaque TLS error on the first tool call. No stub needed: none of these may
 * open a socket.
 */
async function startupValidation(stub, host) {
  console.log('\nstartup validation (fail fast, exit 1, message names the problem)');
  const readme = join(HERE, 'README.md');
  const cases = [
    ['--cert without --key', ['-H', host, '--cert', cert('client.pem')], {}, /--cert and --key must be provided together \(got only --cert\)/],
    ['--key without --cert', ['-H', host, '--key', cert('client.key')], {}, /got only --key/],
    ['--ca alone', ['-H', host, '--ca', cert('ca.pem')], {}, /--ca was provided without --cert and --key/],
    ['missing certificate file', ['-H', host, '--cert', cert('nope.pem'), '--key', cert('client.key')], {}, /Cannot read --cert at .*nope\.pem/],
    ['non-PEM file as --key', ['-H', host, '--cert', cert('client.pem'), '--key', readme], {}, /--key at .* is not a PEM-encoded file/],
    ['cert and key do not match', ['-H', host, '--cert', cert('client.pem'), '--key', cert('untrusted-client.key')], {}, /are not a valid keypair/],
    ['encrypted key, no passphrase', ['-H', host, '--cert', cert('client.pem'), '--key', cert('client.encrypted.key')], { AEM_KEY_PASSPHRASE: '' }, /encrypted private key, but AEM_KEY_PASSPHRASE is not set/],
    ['encrypted key, wrong passphrase', ['-H', host, '--cert', cert('client.pem'), '--key', cert('client.encrypted.key')], { AEM_KEY_PASSPHRASE: 'wrong' }, /are not a valid keypair/],
    ['cert with plaintext non-loopback host', ['-H', 'http://aem.example.com', ...CERT_ARGS], {}, /not https:\/\/: --host \(http:\/\/aem\.example\.com\)/],
    ['--instances names every plaintext offender', ['-I', `ok:${host}:a:b,bad1:http://one.example.com:a:b,bad2:http://two.example.com:a:b`, ...CERT_ARGS], {}, /bad1 \(http:\/\/one\.example\.com\), bad2 \(http:\/\/two\.example\.com\)/],
  ];

  for (const [name, args, env, expected] of cases) {
    const m = stub.mark();
    const { code, stderr } = await runToExit(args, env);
    const socketOpened = stub.since(m) !== '';
    check(name, code === 1 && expected.test(stderr) && !socketOpened,
      `exit=${code} socketOpened=${socketOpened} stderr=${stderr.trim().split('\n').pop()}`);
  }

  // Loopback over http:// is exempt; plain config with no cert stays inert.
  const loopback = await runToExit(['-H', 'http://localhost:4502', ...CERT_ARGS], {});
  check('cert with http://localhost starts (loopback exempt)', loopback.code === 0 && !/Fatal/.test(loopback.stderr), loopback.stderr.trim());
  const plain = await runToExit(['-H', 'http://aem.example.com'], {});
  check('no cert flags: http:// host starts (feature inert)', plain.code === 0 && !/Fatal/.test(plain.stderr), plain.stderr.trim());
}

/** Start stdio, give it time to validate, close stdin, collect exit code and stderr. */
function runToExit(args, env) {
  return new Promise((res) => {
    const child = track(spawn('node', [CLI, '-t', 'stdio', ...args], { env: { ...process.env, ...env } }));
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.stdin.end(), 1500);
    child.on('exit', (code) => { clearTimeout(timer); res({ code, stderr }); });
  });
}

async function envFallbacks(stub, host) {
  console.log('\nenv fallbacks: AEM_CERT_PATH / AEM_KEY_PATH / AEM_CA_PATH, no flags');
  const m = stub.mark();
  const s = stdioSession(['-H', host, '-u', 'admin', '-p', 'admin'], {
    AEM_CERT_PATH: cert('client.pem'),
    AEM_KEY_PATH: cert('client.key'),
    AEM_CA_PATH: cert('ca.pem'),
  });
  await s.init();
  const r = await callNode(s);
  await sleep(200);
  check('certificate from env presented', /clientCN=test-client/.test(stub.since(m)) && !isToolError(r), toolText(r).slice(0, 200));
  s.child.kill();
}

async function serverCertVerification(stub, host) {
  console.log('\nserver certificate is still verified in cert mode');
  const cases = [
    ['--ca from a different CA → rejected', ['--ca', cert('other-ca.pem')]],
    ['no --ca, stub CA not in the trust store → rejected', []],
  ];
  for (const [name, caArgs] of cases) {
    const m = stub.mark();
    const env = { NODE_EXTRA_CA_CERTS: '', NODE_TLS_REJECT_UNAUTHORIZED: '' };
    const s = stdioSession(['-H', host, '--cert', cert('client.pem'), '--key', cert('client.key'), ...caArgs, '-u', 'admin', '-p', 'admin'], env);
    await s.init();
    const r = await callNode(s);
    await sleep(200);
    check(name, isToolError(r) && !/clientCN=test-client GET/.test(stub.since(m)), toolText(r).slice(0, 200));
    s.child.kill();
  }
}

async function multiInstance(stubA, hostA, stubB, hostB) {
  console.log('\n--instances: one certificate, two instances');
  const mA = stubA.mark();
  const mB = stubB.mark();
  const s = stdioSession(['-I', `a:${hostA}:admin:admin,b:${hostB}:other:secret`, ...CERT_ARGS]);
  await s.init();
  const call = (instance) => s.rpc('tools/call', { name: 'getNodeContent', arguments: { path: '/content/e2e', depth: 1, instance } });
  const ra = await call('a');
  const rb = await call('b');
  await sleep(200);
  check('instance a presented the cert to stub A only', /clientCN=test-client .*authorization=Basic <redacted> auth=ok/.test(stubA.since(mA)) && !isToolError(ra), stubA.since(mA));
  check('instance b presented the cert to stub B only', /clientCN=test-client .*authorization=Basic <redacted> auth=ok/.test(stubB.since(mB)) && !isToolError(rb), stubB.since(mB));
  check('each instance hit exactly one stub', stubA.since(mA).split('\n').filter(Boolean).length === 1
    && stubB.since(mB).split('\n').filter(Boolean).length === 1, `A:\n${stubA.since(mA)}\nB:\n${stubB.since(mB)}`);
  s.child.kill();
}

async function bodiesAndEmptyResponses(stub, host) {
  console.log('\ncert transport: POST body, 204 (AEMFetch)');
  const { AEMFetch } = await import(pathToFileURL(join(ROOT, 'dist/aem/aem.fetch.js')).href);
  const { loadCertMaterial } = await import(pathToFileURL(join(ROOT, 'dist/aem/aem.cert-fetch.js')).href);
  const f = new AEMFetch({
    host,
    auth: { username: 'admin', password: 'admin' },
    cert: loadCertMaterial({ cert: cert('client.pem'), key: cert('client.key'), ca: cert('ca.pem') }),
  });
  await f.init();

  let m = stub.mark();
  const payload = { title: 'e2e', 'jcr:content': { a: 1 } };
  const posted = await f.post('/content/e2e/post', payload);
  await sleep(200);
  const echoed = typeof posted === 'string' ? JSON.parse(posted) : posted;
  check('POST body arrives intact over mTLS', /clientCN=test-client POST \/content\/e2e\/post/.test(stub.since(m))
    && echoed?.body && JSON.stringify(JSON.parse(echoed.body)) === JSON.stringify(payload), JSON.stringify(echoed).slice(0, 200));

  m = stub.mark();
  let empty;
  let error;
  try { empty = await f.get('/_204'); } catch (e) { error = e; }
  await sleep(200);
  check('204 with no body is handled', !error && /clientCN=test-client GET \/_204/.test(stub.since(m)), error?.message || JSON.stringify(empty));
}

/** Plain HTTP echo standing in for local AEM, to prove the no-cert path is unchanged. */
async function startPlainEcho() {
  const { createServer: createHttpServer } = await import('node:http');
  const lines = [];
  const server = createHttpServer((req, res) => {
    const scheme = (req.headers.authorization || '<absent>').split(' ')[0];
    lines.push(`${req.method} ${req.url} authorization=${scheme}`);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ plain: true, path: req.url }));
  });
  const port = await new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
  return { server, host: `http://localhost:${port}`, mark: () => lines.length, since: (m) => lines.slice(m).join('\n') };
}

async function plainModeUnchanged() {
  console.log('\nno cert configured: plain http:// AEM, stdio and http transports');
  const echo = await startPlainEcho();
  try {
    let m = echo.mark();
    const s = stdioSession(['-H', echo.host, '-u', 'admin', '-p', 'admin']);
    await s.init();
    const r = await callNode(s);
    await sleep(200);
    check('stdio plain: request reached AEM with Basic', /GET \/content\/e2e\.json.* authorization=Basic/.test(echo.since(m)) && !isToolError(r), echo.since(m) || toolText(r));
    s.child.kill();

    m = echo.mark();
    const port = await freePort();
    const srv = track(spawn('node', [CLI, '-H', echo.host, '-m', String(port)]));
    let init;
    for (let attempt = 0; !init; attempt++) {
      try {
        init = await mcpPost(port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-cert', version: '0' } } });
      } catch (error) {
        if (attempt >= 50) throw error;
        await sleep(100);
      }
    }
    await mcpPost(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sid);
    const call = await mcpPost(port, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'getNodeContent', arguments: { path: '/content/e2e', depth: 1 } } }, init.sid);
    await sleep(200);
    check('http plain: request reached AEM with Basic', /GET \/content\/e2e\.json.* authorization=Basic/.test(echo.since(m)) && /"result"/.test(call.text), echo.since(m) || call.text.slice(0, 200));
    srv.kill();
  } finally {
    echo.server.close();
  }
}

async function mcpPost(port, body, sid) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sid ? { 'mcp-session-id': sid } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  return { sid: res.headers.get('mcp-session-id'), text: await res.text() };
}

function oauthWithCert(port) {
  console.log('\nOAuth S2S + cert (faked IMS, smoke-oauth-cert.mjs): token value, IMS 401, stale-token refresh');
  return new Promise((res) => {
    const child = track(spawn('node', [join(HERE, 'smoke-oauth-cert.mjs')], { env: { ...process.env, PORT: String(port) } }));
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => {
      // Every check must run: a skip would mean the stub was not checking token values.
      check('smoke-oauth-cert.mjs passed with no skips', code === 0 && !/skip/.test(out), out.trim().split('\n').slice(-8).join('\n        '));
      res();
    });
  });
}

// ---------------------------------------------------------------- main

async function main() {
  if (!existsSync(CLI)) {
    console.error('dist/cli.js not found. Run: npm run build:ts');
    process.exit(1);
  }
  if (!existsSync(cert('client.pem'))) {
    console.log('certificates missing, generating them with gen-certs.sh');
    execFileSync('bash', [join(HERE, 'gen-certs.sh')], { stdio: 'inherit' });
  }

  const port = await freePort();
  const host = `https://localhost:${port}`;
  const stub = await startStub(port);
  console.log(`stub on ${host}`);

  const portB = await freePort();
  const hostB = `https://localhost:${portB}`;
  const stubB = await startStub(portB);

  const steps = [
    startupValidation,
    stdioWithCertAndBasic,
    stdioWithEncryptedKey,
    envFallbacks,
    wrongPassword,
    negativeNoCert,
    negativeUntrustedCert,
    serverCertVerification,
    httpWithCert,
    redirectInCertMode,
    bodiesAndEmptyResponses,
    function multiInstanceStep() { return multiInstance(stub, host, stubB, hostB); },
    plainModeUnchanged,
  ];
  for (const step of steps) {
    try {
      await step(stub, host);
    } catch (error) {
      check(`${step.name} ran to completion`, false, error.message);
    }
  }
  await oauthWithCert(port);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  return failed === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(error);
} finally {
  stopAll();
}
process.exit(code);
