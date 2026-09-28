# Manual mTLS test harness

Opt-in integration tests for client certificate support. **Not part of `npm test`** — these
need generated certificates and bind a port, while `npm test` must stay hermetic.

The automated suite (`test/aem.cert-fetch.test.js`) covers every validation failure path and the
"no certificate configured" contract. It cannot cover a real TLS handshake: that needs a genuine
keypair, and committed fixtures expire. That gap is what this directory fills.

## One command: everything, no AEM and no credentials

```bash
npm run build:ts
node test/manual/e2e-cert.mjs
```

Generates certificates if missing, starts its own stub on a free port, drives `dist/cli.js`
over stdio and HTTP, and stops every child process it started. Exits 1 on any failure. Covers:

- startup validation: `--cert`/`--key` alone, `--ca` alone, missing file, non-PEM file,
  mismatched keypair, encrypted key without or with a wrong passphrase, plaintext non-loopback
  host, `--instances` naming every plaintext offender — each exits 1 with the problem named and
  opens no socket; `http://localhost` and no-cert configs start normally
- stdio + cert + Basic: stub sees `clientCN=test-client` and `Authorization: Basic` on the same
  request; stdout carries only JSON-RPC; 200 calls keep the fd count flat
- encrypted key via `AEM_KEY_PASSPHRASE`; `AEM_CERT_PATH`/`AEM_KEY_PATH`/`AEM_CA_PATH` fallbacks
- negative controls: no client cert, and a client cert from a different CA — both rejected
- server certificate still verified: wrong `--ca`, and no `--ca` with the stub CA untrusted
- http transport + cert through `POST /mcp`
- one-hop redirect, POST body and empty 204 through the cert transport
- `--instances` with two stubs: each instance presents the cert to its own host only
- no cert configured: stdio and http against a plain `http://` echo still send Basic
- OAuth S2S + cert, by running `smoke-oauth-cert.mjs` (faked IMS)

It binds localhost ports, so it cannot run inside a network sandbox. The sections below are for
running the pieces by hand.

The stub checks credential **values**, not just the scheme: `e2e-cert.mjs` starts it with
`STUB_BASIC=admin:admin,other:secret` and `STUB_BEARER=fake-ims-access-token`, and anything else
gets 401. Started by hand without those variables it logs `auth=unchecked` and accepts everything.

## Regression: Basic and OAuth without a certificate

```bash
node test/manual/regression-auth.mjs                       # absolute checks only
node test/manual/regression-auth.mjs --baseline <main-checkout>   # plus parity with main
```

A plain `http://` echo stands in for AEM; IMS is faked by `fake-ims.mjs` (`token-1`, `token-2`, …).
Runs the AEMFetch verbs, five connector methods and a stdio `tools/call`, for Basic and for OAuth.

- absolute: exact `Authorization` value on every request; 401 retries once (OAuth: after one IMS
  refresh, with the new token); IMS 401 surfaces as `IMS token request failed: 401`
- parity (`--baseline`): every request — method, URL, all headers except `Host`, body — and every
  result identical to the other build

A `main` checkout to compare against:

```bash
git worktree add --detach "$TMPDIR/aem-main" main
ln -s "$PWD/node_modules" "$TMPDIR/aem-main/node_modules"
(cd "$TMPDIR/aem-main" && npm run build:ts)
```

Pass the absolute path: outside the sandbox `$TMPDIR` may resolve elsewhere.

## Setup

```bash
bash test/manual/gen-certs.sh      # writes test/manual/certs/ (gitignored)
node test/manual/mtls-server.mjs   # https://localhost:14502
```

`gen-certs.sh` wipes and recreates `certs/` on every run. Contents:

- `ca.pem` / `ca.key` — the throwaway CA the stub trusts
- `server.pem` / `server.key` — stub's own certificate, SAN `localhost` + `127.0.0.1`
- `client.pem` / `client.key` — the client certificate, `CN=test-client`
- `client.encrypted.key` — the same key encrypted, passphrase `testpass`
- `untrusted-client.pem` / `.key` — signed by a *different* CA, so the stub must reject it

## Verifying the harness itself

Do this before trusting it to judge any project code. Run from the repo root with the stub
running.

**1 — a valid client certificate is accepted:**

```bash
curl -s --cacert test/manual/certs/ca.pem \
     --cert test/manual/certs/client.pem \
     --key  test/manual/certs/client.key \
     https://localhost:14502/hello
```

Expect HTTP 200 and a JSON echo. The stub logs `clientCN=test-client`.

**2 — no client certificate is rejected** (the negative control that makes every later
`clientCN` line meaningful):

```bash
curl -s --cacert test/manual/certs/ca.pem https://localhost:14502/hello
```

Expect curl to fail on the handshake. The stub logs `handshake rejected: …`.

**3 — a certificate from a foreign CA is rejected**, which distinguishes "our certificate was
accepted" from "any certificate works":

```bash
curl -s --cacert test/manual/certs/ca.pem \
     --cert test/manual/certs/untrusted-client.pem \
     --key  test/manual/certs/untrusted-client.key \
     https://localhost:14502/hello
```

Expect a handshake failure.

## Routes

- `/_204` — 204 with no body, for empty-response handling
- `/_redirect` — 302 with `Location: /_redirected`, for one-hop redirect handling
- anything else — 200 JSON echo of method, path, headers and body

## What the stub logs

One line per request:

```
clientCN=test-client POST /content/x authorization=Basic <redacted> content-type=application/json bodyBytes=42
```

`clientCN` is the proof the handshake presented our certificate. `authorization` is the proof
that application auth still travels alongside it — the two are orthogonal, which is the whole
point of the design. The credential itself is redacted because this prints to a terminal.

## Using it against the MCP server

```bash
node dist/cli.js -H https://localhost:14502 \
  --cert test/manual/certs/client.pem \
  --key  test/manual/certs/client.key \
  --ca   test/manual/certs/ca.pem \
  -u admin -p admin
```

The stub should log both `clientCN=test-client` and `authorization=Basic <redacted>`.

For the encrypted-key path, use `client.encrypted.key` and export
`AEM_KEY_PASSPHRASE=testpass`. There is deliberately no CLI flag for the passphrase, so it never
appears in `ps aux`.

## OAuth S2S + client certificate, without real credentials

```bash
node test/manual/smoke-oauth-cert.mjs
```

Builds an `AEMConnector` with `-i/-s` plus `--cert/--key/--ca` against the stub. The IMS token call
(`src/aem/aem.auth.ts`) goes through global `fetch`, while the AEM leg in cert mode goes through
`node:https`. So the script replaces global `fetch` with a fake IMS that returns a dummy token, and
every AEM request still makes a real mTLS handshake with the stub.

It asserts:

- the connector is in OAuth (AEMaaCS) mode;
- the token was requested from IMS exactly once, via global `fetch`, with the configured
  `client_id` and `grant_type=client_credentials`;
- the stub saw `clientCN=test-client` **and** `Authorization: Bearer …` on the same request;
- no AEM request went through global `fetch`.

What it does **not** prove: that real Adobe IMS accepts real credentials, or that a real
AEMaaCS environment accepts the token behind an mTLS-terminating Dispatcher/CDN. That is the
pending check below.

## TODO — before merging the final PR: real IMS credentials

**Status: not done.** Nobody on this branch has had real OAuth Server-to-Server credentials. Run
this on the `cert-auth` branch once the final PR is open, and tick it off in the PR's test plan.

Needs: `clientId`/`clientSecret` from an Adobe Developer Console project with an OAuth
Server-to-Server credential for an AEM as a Cloud Service environment, plus a client certificate
that environment's Dispatcher/CDN accepts (or, if no mTLS-protected environment exists, the stub).

1. `npm ci && npm run build`
2. **Real IMS + stub** — proves the real token is fetched and sent over mTLS:

   ```bash
   bash test/manual/gen-certs.sh
   node test/manual/mtls-server.mjs          # other terminal
   node dist/cli.js -H https://localhost:14502 \
     -i "$AEM_CLIENT_ID" -s "$AEM_CLIENT_SECRET" \
     --cert test/manual/certs/client.pem --key test/manual/certs/client.key \
     --ca test/manual/certs/ca.pem
   ```

   Drive one `tools/call` (e.g. `getNodeContent`) via POST `/mcp`. Expect no IMS error on stderr, and
   the stub logs `clientCN=test-client … authorization=Bearer <redacted>`.
3. **Real environment** (only if an mTLS-protected AEMaaCS environment exists): same command with
   `-H https://<author-host>` and that environment's client cert/key (plus `--ca` only if its
   server certificate is not publicly trusted). Expect `/health` → `"aem":"connected"` and a
   `getNodeContent` call returning real content.
4. **Negative control**: repeat step 3 without `--cert/--key` — expect a TLS handshake failure, not
   a 401. Confirms step 3 actually depended on the certificate.

Record in the PR: date, who ran it, which steps (2 only, or 2–4), and the result.
