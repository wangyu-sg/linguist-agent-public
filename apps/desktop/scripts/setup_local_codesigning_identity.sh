#!/usr/bin/env bash
set -euo pipefail

IDENTITY_NAME="${LA_MAC_LOCAL_CODESIGN_IDENTITY_NAME:-Linguist Agent Local Development}"
KEYCHAIN="${LA_MAC_LOCAL_CODESIGN_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"

if /usr/bin/security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null \
  | /usr/bin/grep -F "\"$IDENTITY_NAME\"" >/dev/null; then
  echo "Code-signing identity is already ready: $IDENTITY_NAME"
  exit 0
fi

OPENSSL_BIN="$(command -v openssl || true)"
[[ -n "$OPENSSL_BIN" ]] || { echo "OpenSSL is required." >&2; exit 1; }
[[ -f "$KEYCHAIN" ]] || { echo "Login keychain not found: $KEYCHAIN" >&2; exit 1; }

TMP_DIR="$(/usr/bin/mktemp -d "/tmp/la-codesign.XXXXXX")"
trap '/bin/rm -rf "$TMP_DIR"' EXIT
umask 077
P12_PASSWORD="$($OPENSSL_BIN rand -hex 24)"

"$OPENSSL_BIN" req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
  -subj "/CN=$IDENTITY_NAME/O=Linguist Agent/OU=Local Development" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,digitalSignature,keyCertSign" \
  -addext "extendedKeyUsage=codeSigning" \
  -keyout "$TMP_DIR/identity.key" -out "$TMP_DIR/identity.crt" >/dev/null 2>&1
"$OPENSSL_BIN" pkcs12 -export \
  -inkey "$TMP_DIR/identity.key" -in "$TMP_DIR/identity.crt" \
  -name "$IDENTITY_NAME" -passout "pass:$P12_PASSWORD" -out "$TMP_DIR/identity.p12"
/usr/bin/security import "$TMP_DIR/identity.p12" -k "$KEYCHAIN" -f pkcs12 \
  -P "$P12_PASSWORD" -x -T /usr/bin/codesign -T /usr/bin/security >/dev/null
/usr/bin/security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$TMP_DIR/identity.crt"

/usr/bin/security find-identity -v -p codesigning "$KEYCHAIN" \
  | /usr/bin/grep -F "\"$IDENTITY_NAME\"" >/dev/null
echo "Created stable local code-signing identity: $IDENTITY_NAME"
