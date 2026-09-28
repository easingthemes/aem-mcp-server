#!/usr/bin/env node
/**
 * Regression check for the two auth modes that existed before client
 * certificates: Basic and OAuth S2S, both with no certificate configured.
 *
 * A plain http:// echo server stands in for AEM and records every request it
 * receives. The same scenarios run through AEMConnector and through
 * dist/cli.js over stdio. IMS is faked (fake-ims.mjs), so no real credentials
 * are needed.
 *
 * Two kinds of checks:
 *   - absolute: Authorization carries exactly the configured credential, 401
 *     retries once (OAuth: with a freshly issued token), IMS rejection surfaces.
 *   - parity (with --baseline): every request — method, URL, all headers except
 *     Host, body — and every result is identical to another build, e.g. main.
 *
 *   npm run build:ts
 *   node test/manual/regression-auth.mjs
 *
 *   # parity against main, built in a throwaway worktree:
 *   git worktree add --detach "$TMPDIR/aem-main" main
 *   ln -s "$PWD/node_modules" "$TMPDIR/aem-main/node_modules"
 *   (cd "$TMPDIR/aem-main" && npm run build:ts)
 *   node test/manual/regression-auth.mjs --baseline "$TMPDIR/aem-main"
 *
 * Binds a localhost port, so it will not run inside a network sandbox.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_IMS = join(HERE, 'fake-ims.mjs');
const BASIC = { user: 'admin', pass: 'admin' };
const OAUTH = { id: 'fake-client-id', secret: 'fake-client-secret' };
const RPC_TIMEOUT_MS = 10_000;

// ================================================================ worker
// Runs inside a child process so each build and each auth mode gets a fresh
// module graph and a fresh fake IMS.

if (process.argv[2] === '--worker') {
  const [, , , root, mode, host] = process.argv;
  const { imsTokensIssued } = await import(pathToFileURL(FAKE_IMS).href);
  const { AEMConnector } = await import(pathToFileURL(join(root, 'dist/aem/aem.connector.js')).href);

  const connector = new AEMConnector({ host, ...(mode === 'oauth' ? OAUTH : BASIC) });
  const outcomes = [];
  const run = async (name, fn) => {
    try {
      const result = await fn();
      const shown = result instanceof Response ? { status: result.status } : result;
      outcomes.push([name, normalise(JSON.stringify(shown ?? null))]);
    } catch (error) {
      outcomes.push([name, `error: ${normalise(String(error?.message || error))}`]);
    }
  };

  await run('init', () => connector.init());
  // AEMFetch is private in TypeScript only; the verbs are what every tool sits on.
  const f = connector.fetch;
  await run('fetch.get', () => f.get('/g', { a: 1, b: 'x y' }));
  await run('fetch.post json', () => f.post('/p-json', { x: 1, nested: { y: [1, 2] } }));
  await run('fetch.post form', () => f.post('/p-form', new URLSearchParams({ y: '2', ':operation': 'x' })));
  await run('fetch.put', () => f.put('/put', { z: 3 }));
  await run('fetch.delete', () => f.delete('/d'));
  await run('fetch.postWithHeaders', () => f.postWithHeaders('/pwh', new URLSearchParams({ w: '4' })));
  await run('fetch.get 401 once', () => f.get('/_401once'));
  await run('getNodeContent', () => connector.getNodeContent('/content/reg', 1));
  await run('listPages', () => connector.listPages('/content/reg', 1, 5));
  await run('getPageProperties', () => connector.getPageProperties('/content/reg/page'));
  await run('getAssetMetadata', () => connector.getAssetMetadata('/content/dam/reg/a.png'));
  await run('executeJCRQuery', () => connector.executeJCRQuery('reg', 5));

  process.stdout.write(JSON.stringify({ isAEMaaCS: connector.isAEMaaCS, imsTokens: imsTokensIssued(), outcomes }));
  process.exit(0);
}

/** Strip values that legitimately differ between runs. */
function normalise(text) {
  return text
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<date>')
    .replace(/127\.0\.0\.1:\d+|localhost:\d+/g, '<host>');
}

// ================================================================ parent

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${String(detail).split('\n').join('\n        ')}` : ''}`);
}

/** Plain http:// AEM stand-in. The first /_401once per run answers 401. */
function startEcho() {
  let requests = [];
  let sent401 = false;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const { host, ...headers } = req.headers;
      requests.push({ method: req.method, url: req.url, headers, body: Buffer.concat(chunks).toString('utf8') });
      if (req.url.startsWith('/_401once') && !sent401) {
        sent401 = true;
        res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"unauthorized"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, path: req.url }));
    });
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({
    server,
    host: `http://127.0.0.1:${server.address().port}`,
    take() {
      const taken = requests;
      requests = [];
      sent401 = false;
      return taken;
    },
  })));
}

function runWorker(root, mode, host, env = {}) {
  return new Promise((res, rej) => {
    const child = spawn('node', [fileURLToPath(import.meta.url), '--worker', root, mode, host], { env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => {
      if (code !== 0) return rej(new Error(`worker ${mode} @ ${root} exited ${code}: ${err.trim()}`));
      try { res(JSON.parse(out)); } catch { rej(new Error(`worker ${mode} printed non-JSON: ${out.slice(0, 200)}`)); }
    });
  });
}

/** One tools/call through the real MCP stdio entry point of a given build. */
function runStdio(root, mode, host) {
  return new Promise((res, rej) => {
    const creds = mode === 'oauth' ? ['-i', OAUTH.id, '-s', OAUTH.secret] : ['-u', BASIC.user, '-p', BASIC.pass];
    const child = spawn('node', ['--import', pathToFileURL(FAKE_IMS).href, join(root, 'dist/cli.js'), '-t', 'stdio', '-H', host, ...creds]);
    const timer = setTimeout(() => { child.kill(); rej(new Error(`stdio ${mode} @ ${root} timed out`)); }, RPC_TIMEOUT_MS);
    const lines = [];
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        lines.push(line);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'getNodeContent', arguments: { path: '/content/reg', depth: 1 } } })}\n`);
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          res({ text: normalise(msg.result?.content?.[0]?.text ?? JSON.stringify(msg.error)), stdoutLines: lines });
        }
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'regression-auth', version: '0' } } })}\n`);
  });
}

/** Everything one build does for one auth mode. */
async function capture(root, mode, echo) {
  echo.take();
  const worker = await runWorker(root, mode, echo.host);
  const workerRequests = echo.take();
  const stdio = await runStdio(root, mode, echo.host);
  const stdioRequests = echo.take();
  return { worker, workerRequests, stdio, stdioRequests };
}

const authOf = (reqs) => [...new Set(reqs.map((r) => r.headers.authorization))];

function absoluteChecks(mode, run) {
  const { worker, workerRequests, stdio, stdioRequests } = run;
  const expected = `Basic ${Buffer.from(`${BASIC.user}:${BASIC.pass}`).toString('base64')}`;
  const retried = workerRequests.filter((r) => r.url.startsWith('/_401once'));
  const outcome = (name) => worker.outcomes.find(([n]) => n === name)?.[1];

  if (mode === 'basic') {
    check('connector is not in OAuth mode', worker.isAEMaaCS === false);
    check('no IMS call', worker.imsTokens === 0, `imsTokens=${worker.imsTokens}`);
    check('every request carries exactly Basic base64(admin:admin)', authOf(workerRequests).every((a) => a === expected), authOf(workerRequests).join(', '));
    check('401 → one retry with the same Basic credential', retried.length === 2 && authOf(retried).join() === expected, authOf(retried).join(', '));
  } else {
    check('connector is in OAuth (AEMaaCS) mode', worker.isAEMaaCS === true);
    const beforeRetry = workerRequests.slice(0, workerRequests.indexOf(retried[0]) + 1);
    const afterRetry = workerRequests.slice(workerRequests.indexOf(retried[0]) + 1);
    check('requests before the 401 carry Bearer token-1', authOf(beforeRetry).join() === 'Bearer token-1', authOf(beforeRetry).join(', '));
    check('401 → exactly one IMS refresh → retry carries Bearer token-2', worker.imsTokens === 2 && retried.length === 2
      && retried[1].headers.authorization === 'Bearer token-2', `imsTokens=${worker.imsTokens} retried=${authOf(retried).join(', ')}`);
    check('requests after the refresh keep Bearer token-2', authOf(afterRetry).every((a) => a === 'Bearer token-2'), authOf(afterRetry).join(', '));
  }
  check('401 retry returned the 200 body', /"ok":true/.test(outcome('fetch.get 401 once') || ''), outcome('fetch.get 401 once'));
  check('form POST sent as urlencoded', workerRequests.some((r) => r.url === '/p-form' && /x-www-form-urlencoded/.test(r.headers['content-type']) && r.body === 'y=2&%3Aoperation=x'),
    JSON.stringify(workerRequests.find((r) => r.url === '/p-form')));
  check('JSON POST sent as JSON', workerRequests.some((r) => r.url === '/p-json' && r.headers['content-type'] === 'application/json' && r.body === '{"x":1,"nested":{"y":[1,2]}}'),
    JSON.stringify(workerRequests.find((r) => r.url === '/p-json')));
  const stdioAuth = authOf(stdioRequests);
  check('stdio tools/call reached AEM with the same scheme', stdioRequests.length > 0
    && stdioAuth.every((a) => (mode === 'basic' ? a === expected : a === 'Bearer token-1')), stdioAuth.join(', ') || 'no requests');
  check('stdio stdout carries only JSON-RPC', stdio.stdoutLines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));
}

async function imsRejected(root, echo) {
  echo.take();
  const worker = await runWorker(root, 'oauth', echo.host, { FAKE_IMS_STATUS: '401' });
  const reqs = echo.take();
  const init = worker.outcomes.find(([n]) => n === 'init')?.[1];
  check('IMS 401 surfaces as "IMS token request failed: 401"', /IMS token request failed: 401/.test(init || ''), init);
  check('no request reaches AEM without a token', reqs.every((r) => r.headers.authorization !== 'Bearer undefined' && r.headers.authorization !== 'Bearer '),
    authOf(reqs).join(', '));
}

function parity(name, current, baseline) {
  try {
    assert.deepEqual(current, baseline);
    check(name, true);
  } catch (error) {
    check(name, false, error.message.split('\n').slice(0, 30).join('\n'));
  }
}

// ---------------------------------------------------------------- main

const baselineIdx = process.argv.indexOf('--baseline');
const baselineRoot = baselineIdx > 0 ? resolve(process.argv[baselineIdx + 1]) : null;
const currentRoot = resolve(HERE, '../..');

const echo = await startEcho();
try {
  for (const mode of ['basic', 'oauth']) {
    console.log(`\n${mode === 'basic' ? 'Basic' : 'OAuth S2S'}, no certificate — this build`);
    const current = await capture(currentRoot, mode, echo);
    absoluteChecks(mode, current);

    if (baselineRoot) {
      console.log(`${mode === 'basic' ? 'Basic' : 'OAuth S2S'} — parity with ${baselineRoot}`);
      const baseline = await capture(baselineRoot, mode, echo);
      parity(`connector: all ${current.workerRequests.length} requests identical (method, URL, headers, body)`, current.workerRequests, baseline.workerRequests);
      parity(`connector: all ${current.worker.outcomes.length} results identical`, current.worker, baseline.worker);
      parity('stdio: requests identical', current.stdioRequests, baseline.stdioRequests);
      parity('stdio: tool result identical', current.stdio.text, baseline.stdio.text);
    }
  }
  console.log('\nOAuth S2S, IMS rejects the credentials');
  await imsRejected(currentRoot, echo);
} catch (error) {
  check('ran to completion', false, error.stack || error.message);
} finally {
  echo.server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed${baselineRoot ? '' : ' (no --baseline: parity not checked)'}`);
process.exit(failed ? 1 : 0);
