#!/usr/bin/env bash
# The Docker image, end to end, with a real SMTP server (Mailpit, STARTTLS, throw-away CA).
# Never deploys or pushes anything; every secret and certificate is generated here and dropped.
# Usage: test/e2e/run-docker.sh            builds docker/Dockerfile and tests it
#        E2E_IMAGE=ghcr.io/...:tag test/e2e/run-docker.sh   tests an image that already exists
set -euo pipefail
cd "$(dirname "$0")/../.."

RUN="makisend-e2e-$$"
# E2E_IMAGE, not IMAGE: CI jobs commonly export IMAGE for the registry name, which must not be
# mistaken for "test this existing image".
IMAGE="${E2E_IMAGE:-}"
PORT="${PORT:-18787}"
MAILPIT_PORT="${MAILPIT_PORT:-18025}"
WORK="$(mktemp -d)"
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then docker logs "$RUN-app" 2>&1 | tail -60 || true; fi
  docker rm -f "$RUN-app" "$RUN-mail" >/dev/null 2>&1 || true
  docker volume rm "$RUN-data" >/dev/null 2>&1 || true
  docker network rm "$RUN" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ -z "$IMAGE" ]; then
  IMAGE="makisend:e2e"
  docker build -f ../docker/Dockerfile -t "$IMAGE" ..
fi

# A CA and a certificate for smtp.example.test: the app verifies TLS, so the SMTP server has to
# present a certificate the image trusts (SSL_CERT_FILE below, for this container only).
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$WORK/ca.key" -out "$WORK/ca.crt" -days 2 -subj "/CN=MakiSend e2e CA" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout "$WORK/smtp.key" -out "$WORK/smtp.csr" -subj "/CN=smtp.example.test" 2>/dev/null
printf "subjectAltName=DNS:smtp.example.test\nbasicConstraints=CA:FALSE\n" > "$WORK/ext.cnf"
openssl x509 -req -in "$WORK/smtp.csr" -CA "$WORK/ca.crt" -CAkey "$WORK/ca.key" -CAcreateserial -out "$WORK/smtp.crt" -days 2 -extfile "$WORK/ext.cnf" 2>/dev/null
chmod 644 "$WORK"/*

docker network create "$RUN" >/dev/null
docker run -d --name "$RUN-mail" --network "$RUN" --network-alias smtp.example.test \
  -v "$WORK:/certs:ro" -p "$MAILPIT_PORT:8025" \
  -e MP_SMTP_BIND_ADDR=0.0.0.0:587 -e MP_SMTP_TLS_CERT=/certs/smtp.crt -e MP_SMTP_TLS_KEY=/certs/smtp.key \
  -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 \
  axllent/mailpit:v1.33 >/dev/null

start_app() {
  docker run -d --name "$RUN-app" --network "$RUN" -p "$PORT:8787" -v "$RUN-data:/data" \
    -v "$WORK/ca.crt:/ca/ca.crt:ro" -e SSL_CERT_FILE=/ca/ca.crt \
    -e ENCRYPTION_KEY="$ENCRYPTION_KEY" -e BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
    "$IMAGE" >/dev/null
}
wait_ready() {
  for _ in $(seq 1 90); do
    curl -fs "http://127.0.0.1:$PORT/openapi.json" >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "The image did not answer in time" >&2
  return 1
}

# The same secrets across the restart, or the stored data would be unreadable.
ENCRYPTION_KEY="$(openssl rand -hex 32)"
BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
export BASE_URL="http://127.0.0.1:$PORT" MAILPIT_URL="http://127.0.0.1:$MAILPIT_PORT" STATE_FILE="$WORK/state.json"

start_app
wait_ready
pnpm exec tsx test/e2e/docker.ts before

docker restart "$RUN-app" >/dev/null
wait_ready
pnpm exec tsx test/e2e/docker.ts after
