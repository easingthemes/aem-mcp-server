#!/usr/bin/env bash
#
# Generates a throwaway CA, server certificate and client certificate for
# exercising mTLS against test/manual/mtls-server.mjs.
#
# Everything lands in test/manual/certs/, which is gitignored. Nothing here is
# reused between runs and nothing is committed — re-run the script whenever the
# certificates expire or you want a clean slate.
#
# Uses -extfile rather than -addext so it works on both LibreSSL (shipped with
# macOS) and OpenSSL 3.x.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
DAYS=825
KEY_PASSPHRASE="testpass"

rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"

echo "==> Certificate authority"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout ca.key -out ca.pem -days "$DAYS" \
  -subj "/CN=aem-mcp-test-ca" 2>/dev/null

echo "==> Server certificate (CN=localhost)"
openssl req -newkey rsa:2048 -nodes \
  -keyout server.key -out server.csr \
  -subj "/CN=localhost" 2>/dev/null

cat > server.ext <<'EOF'
subjectAltName = DNS:localhost, IP:127.0.0.1
extendedKeyUsage = serverAuth
EOF

openssl x509 -req -in server.csr \
  -CA ca.pem -CAkey ca.key -CAcreateserial \
  -out server.pem -days "$DAYS" -extfile server.ext 2>/dev/null

echo "==> Client certificate (CN=test-client)"
openssl req -newkey rsa:2048 -nodes \
  -keyout client.key -out client.csr \
  -subj "/CN=test-client" 2>/dev/null

cat > client.ext <<'EOF'
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -in client.csr \
  -CA ca.pem -CAkey ca.key -CAcreateserial \
  -out client.pem -days "$DAYS" -extfile client.ext 2>/dev/null

# An encrypted copy of the same key, for exercising the AEM_KEY_PASSPHRASE path.
echo "==> Encrypted client key (passphrase: ${KEY_PASSPHRASE})"
# -v2 aes-256-cbc: LibreSSL (macOS system openssl) otherwise defaults to pbeWithMD5AndDES-CBC,
# which Node's OpenSSL 3 rejects as "digital envelope routines::unsupported".
openssl pkcs8 -topk8 -v2 aes-256-cbc -in client.key -out client.encrypted.key \
  -passout "pass:${KEY_PASSPHRASE}" 2>/dev/null

# A second CA and a client signed by it: presenting this to the stub must be
# rejected, which distinguishes "our cert was accepted" from "any cert works".
echo "==> Untrusted client certificate (signed by a foreign CA)"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout other-ca.key -out other-ca.pem -days "$DAYS" \
  -subj "/CN=aem-mcp-untrusted-ca" 2>/dev/null
openssl req -newkey rsa:2048 -nodes \
  -keyout untrusted-client.key -out untrusted-client.csr \
  -subj "/CN=untrusted-client" 2>/dev/null
openssl x509 -req -in untrusted-client.csr \
  -CA other-ca.pem -CAkey other-ca.key -CAcreateserial \
  -out untrusted-client.pem -days "$DAYS" -extfile client.ext 2>/dev/null

rm -f ./*.csr ./*.ext ./*.srl

echo
echo "Wrote to $DIR:"
ls -1 "$DIR" | sed 's/^/  /'
echo
echo "Next: node test/manual/mtls-server.mjs"
