#!/usr/bin/env node
/**
 * A stand-in for an AEM Dispatcher configured with `SSLVerifyClient require`.
 *
 * Demands a client certificate, then logs the peer CN and the Authorization
 * scheme it received. Those two facts together are what prove the composable
 * model works: the certificate authenticates the connection while Basic/OAuth
 * still authenticates the user.
 *
 * Not part of `npm test` — it needs certificates from ./gen-certs.sh and binds
 * a port. Run it by hand.
 *
 *   bash test/manual/gen-certs.sh
 *   node test/manual/mtls-server.mjs
 *
 * Routes:
 *   /_204      -> 204 with no body      (empty-response handling)
 *   /_redirect -> 302 with Location     (one-hop redirect handling)
 *   anything   -> 200 JSON echo of method, path, headers and body
 *
 * Credential checking is opt-in, so running the stub by hand stays permissive:
 *   STUB_BASIC="admin:admin,other:secret"   accepted Basic user:pass pairs
 *   STUB_BEARER="token1,token2"             accepted Bearer tokens
 * When either is set, any other Authorization gets 401 and logs auth=rejected.
 * Unset, every request logs auth=unchecked.
 */

import https from 'node:https';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CERTS = join(dirname(fileURLToPath(import.meta.url)), 'certs');
const PORT = Number(process.env.PORT || 14502);

let tls;
try {
  tls = {
    key: readFileSync(join(CERTS, 'server.key')),
    cert: readFileSync(join(CERTS, 'server.pem')),
    ca: readFileSync(join(CERTS, 'ca.pem')),
  };
} catch (error) {
  console.error(`Cannot read certificates from ${CERTS}`);
  console.error('Run: bash test/manual/gen-certs.sh');
  process.exit(1);
}

const list = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []);
const ACCEPTED_BASIC = new Set(list(process.env.STUB_BASIC).map((pair) => Buffer.from(pair).toString('base64')));
const ACCEPTED_BEARER = new Set(list(process.env.STUB_BEARER));
const CHECKING = ACCEPTED_BASIC.size > 0 || ACCEPTED_BEARER.size > 0;

/** 'ok' | 'rejected' when checking is on, 'unchecked' otherwise. */
function checkAuthorization(value) {
  if (!CHECKING) return 'unchecked';
  const [scheme, credential] = (value || '').split(' ');
  if (scheme === 'Basic' && ACCEPTED_BASIC.has(credential)) return 'ok';
  if (scheme === 'Bearer' && ACCEPTED_BEARER.has(credential)) return 'ok';
  return 'rejected';
}

/** Keep the scheme, drop the credential — this prints to a shared terminal. */
function redactAuthorization(value) {
  if (!value) return '<absent>';
  const [scheme] = value.split(' ');
  return `${scheme} <redacted>`;
}

const server = https.createServer(
  { ...tls, requestCert: true, rejectUnauthorized: true },
  (req, res) => {
    const peer = req.socket.getPeerCertificate();
    const clientCN = peer?.subject?.CN || '<none>';
    const authorization = redactAuthorization(req.headers.authorization);
    const auth = checkAuthorization(req.headers.authorization);

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      console.log(
        `clientCN=${clientCN} ${req.method} ${req.url} `
        + `authorization=${authorization} auth=${auth} content-type=${req.headers['content-type'] || '<absent>'}`
        + (body ? ` bodyBytes=${body.length}` : ''),
      );

      if (auth === 'rejected') {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized', auth }));
        return;
      }

      if (req.url === '/_204') {
        res.writeHead(204).end();
        return;
      }

      if (req.url === '/_redirect') {
        res.writeHead(302, { Location: '/_redirected' }).end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        clientCN,
        method: req.method,
        path: req.url,
        authorization,
        auth,
        contentType: req.headers['content-type'] || null,
        body,
      }, null, 2));
    });
  },
);

// Without this, a rejected handshake is silent and the negative control looks
// indistinguishable from the server being down.
server.on('tlsClientError', (error) => {
  console.log(`handshake rejected: ${error.code || error.message}`);
});

// listen() reports failures through an 'error' event, not through its callback.
// Without this handler an EADDRINUSE or EPERM surfaces as an unhandled event and
// a stack trace instead of an actionable message.
server.on('error', (error) => {
  console.error(`Cannot listen on 127.0.0.1:${PORT}: ${error.code || error.message}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mTLS stub listening on https://localhost:${PORT} (requestCert, rejectUnauthorized)`);
  console.log('Waiting for requests. Ctrl-C to stop.');
});
