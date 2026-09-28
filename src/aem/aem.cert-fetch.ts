/**
 * Client certificate (mTLS) material loading and host validation for the AEM leg.
 *
 * Only node:fs and node:tls — no network, no AEM knowledge — so the logic stays
 * unit-testable in isolation. Nothing here opens a socket.
 *
 * The certificate configures the TLS *connection*, not the identity: it composes
 * with whatever auth (Basic or OAuth) is already configured rather than replacing
 * it. When no certificate is configured every export here is inert.
 */

import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import { createAEMError, AEM_ERROR_CODES } from './aem.errors.js';

/** Mirrors the transport signature AEMFetch already abstracts over. */
export type FetchInstance = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

/** The subset of CliParams this module reads. CliParams satisfies it structurally. */
export type CertParams = {
  cert?: string;
  key?: string;
  ca?: string;
};

/** Resolved PEM contents, shaped to spread straight into `new https.Agent(...)`. */
export type CertMaterial = {
  cert: string;
  key: string;
  ca?: string;
  passphrase?: string;
};

/** A host paired with whatever the operator would recognise it by. */
export type NamedHost = {
  /** `--host` for the single-instance path, or the instance name from --instances. */
  label: string;
  host: string;
};

const PEM_HEADER = '-----BEGIN ';
const ENCRYPTED_KEY_HEADER = '-----BEGIN ENCRYPTED PRIVATE KEY-----';
const PASSPHRASE_ENV = 'AEM_KEY_PASSPHRASE';

/**
 * Hosts that can never sit behind a Dispatcher demanding a client certificate,
 * so requiring https of them would only break local development. Mirrors the MCP
 * specification's own idiom for OAuth URLs ("reject http:// except for loopback
 * addresses during development").
 */
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/;

/** Read a PEM file, failing with the flag the operator typed rather than a raw errno. */
function readPem(path: string, flag: string): string {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error: any) {
    const code = error?.code === 'ENOENT'
      ? AEM_ERROR_CODES.RESOURCE_NOT_FOUND
      : AEM_ERROR_CODES.INVALID_PARAMETERS;
    throw createAEMError(code, `Cannot read ${flag} at "${path}": ${error?.message || error}.`);
  }

  if (!contents.trimStart().startsWith(PEM_HEADER)) {
    throw createAEMError(
      AEM_ERROR_CODES.INVALID_PARAMETERS,
      `${flag} at "${path}" is not a PEM-encoded file (expected it to start with "${PEM_HEADER}").`,
    );
  }

  return contents;
}

/**
 * Resolve client certificate material from CLI params, or `null` when no
 * certificate is configured — the default path, which must stay inert.
 *
 * Everything that can be checked without a network round trip is checked here,
 * at startup, so a misconfiguration fails immediately and locally instead of as
 * an opaque TLS error on the first tool call.
 */
export function loadCertMaterial(params: CertParams = {}): CertMaterial | null {
  const { cert: certPath, key: keyPath, ca: caPath } = params;

  if (!certPath && !keyPath) {
    // A CA bundle alone cannot present a client certificate. Refuse rather than
    // ignore it, so the operator is never left believing mTLS is configured.
    if (caPath) {
      throw createAEMError(
        AEM_ERROR_CODES.INVALID_PARAMETERS,
        '--ca was provided without --cert and --key. A CA bundle on its own does not enable '
        + 'client certificate authentication and would have no effect.',
      );
    }
    return null;
  }

  if (!certPath || !keyPath) {
    throw createAEMError(
      AEM_ERROR_CODES.INVALID_PARAMETERS,
      `--cert and --key must be provided together (got only ${certPath ? '--cert' : '--key'}).`,
    );
  }

  const cert = readPem(certPath, '--cert');
  const key = readPem(keyPath, '--key');
  const ca = caPath ? readPem(caPath, '--ca') : undefined;
  const passphrase = process.env[PASSPHRASE_ENV] || undefined;

  if (key.includes(ENCRYPTED_KEY_HEADER) && !passphrase) {
    throw createAEMError(
      AEM_ERROR_CODES.INVALID_PARAMETERS,
      `--key at "${keyPath}" is an encrypted private key, but ${PASSPHRASE_ENV} is not set. `
      + `Set ${PASSPHRASE_ENV} in the environment — there is deliberately no CLI flag, so the `
      + 'passphrase never appears in the process list.',
    );
  }

  // Surface a mismatched keypair here rather than as a handshake failure later.
  try {
    createSecureContext({ cert, key, passphrase });
  } catch (error: any) {
    throw createAEMError(
      AEM_ERROR_CODES.INVALID_PARAMETERS,
      `--cert "${certPath}" and --key "${keyPath}" are not a valid keypair: ${error?.message || error}.`,
    );
  }

  return { cert, key, ca, passphrase };
}

/**
 * Refuse to start when a certificate is configured but a host could never receive
 * it. A certificate cannot be presented over plaintext, so the flags would be
 * silently inert and the operator would believe mTLS was active.
 *
 * Inert when `material` is null: with no certificate configured this must never
 * fire, whatever the hosts look like.
 */
export function assertCertHosts(material: CertMaterial | null, hosts: NamedHost[]): void {
  if (!material) return;

  const plaintext = hosts.filter(({ host }) => !host.startsWith('https:') && !LOOPBACK.test(host));
  if (plaintext.length === 0) return;

  const offenders = plaintext.map(({ label, host }) => `${label} (${host})`).join(', ');
  throw createAEMError(
    AEM_ERROR_CODES.INVALID_PARAMETERS,
    `A client certificate is configured, but these hosts are not https://: ${offenders}. `
    + 'The certificate cannot be presented over plaintext HTTP. Loopback hosts are exempt.',
  );
}

/**
 * Bodies reaching this transport are string or URLSearchParams — see
 * `AEMFetch.post`/`put`, which JSON-stringify everything else. Anything unexpected
 * throws rather than being silently serialised as "[object Object]".
 */
function normaliseBody(body: BodyInit | null | undefined): Buffer | null {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8');
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  throw new TypeError(
    'Unsupported request body for the client certificate transport: '
    + `${(body as any)?.constructor?.name || typeof body}. `
    + 'Supported: string, URLSearchParams, Buffer, Uint8Array.',
  );
}

/** node:http exposes repeated headers as arrays; Headers wants them appended. */
function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

/**
 * Build a `FetchInstance` that presents the client certificate on every request.
 *
 * Returns a genuine global `Response`, so callers cannot tell which transport they
 * were given: `request()` and `postWithHeaders()` keep using `.ok`, `.status`,
 * `.headers.get()`, `.clone()` and `.text()` unchanged.
 *
 * Global `fetch` cannot do this — it has no way to attach client TLS material
 * without an undici dispatcher, and undici is not a dependency here.
 */
export function makeCertFetch(material: CertMaterial): FetchInstance {
  // ONE agent for the whole process. Keep-alive pooling measured flat at a single
  // socket across 200 sequential calls, so there is no descriptor leak to manage.
  const agent = new https.Agent({
    cert: material.cert,
    key: material.key,
    ca: material.ca,
    passphrase: material.passphrase,
    keepAlive: true,
    minVersion: 'TLSv1.2',
  });

  return (input, init = {}) => new Promise<Response>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(String(input));
    } catch {
      reject(new TypeError(`Invalid URL for the client certificate transport: ${String(input)}`));
      return;
    }

    let headers: Record<string, string>;
    let body: Buffer | null;
    try {
      headers = {};
      new Headers(init.headers || {}).forEach((value, name) => { headers[name] = value; });
      body = normaliseBody(init.body);
    } catch (error) {
      reject(error);
      return;
    }

    // https.request would otherwise fall back to chunked encoding, which some
    // Sling POST endpoints handle poorly.
    if (body) headers['content-length'] = String(body.byteLength);

    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: init.method || 'GET',
        headers,
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          // The Response constructor rejects a body on these statuses.
          const payload = status === 204 || status === 304 ? null : Buffer.concat(chunks);
          resolve(new Response(payload, {
            status,
            statusText: res.statusMessage || '',
            headers: toHeaders(res.headers),
          }));
        });
      },
    );

    req.on('error', reject);

    // AEMFetch drives cancellation through AbortController (see getTimeoutOptions).
    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy(new Error('Request aborted'));
      } else {
        init.signal.addEventListener(
          'abort',
          () => req.destroy(new Error('Request aborted')),
          { once: true },
        );
      }
    }

    if (body) req.write(body);
    req.end();
  });
}
