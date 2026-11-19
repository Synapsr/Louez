#!/bin/bash
set -e

cd /opt/louez

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 1. Odczytanie wersji przekazanej jako argument (np. v1.1.0) lub fallback do latest
TARGET_TAG="${1:-latest}"
log "🚀 Rozpoczynam wdrożenie wersji: ${TARGET_TAG}"

# 2. Ustawienie taga obrazu w środowisku i pobranie
export LOUEZ_IMAGE_TAG="${TARGET_TAG}"
log "📦 Pobieram najnowsze obrazy z GHCR dla tagu ${TARGET_TAG}..."

if ! docker compose pull louez background-removal; then
  # Jeśli tag zaczyna się od 'v' (np. v3.0.0), spróbuj bez prefiksu 'v' (np. 3.0.0)
  if [[ "${TARGET_TAG}" =~ ^v[0-9] ]]; then
    FALLBACK_TAG="${TARGET_TAG#v}"
    log "⚠️ Nie znaleziono tagu ${TARGET_TAG} na GHCR. Próbuję z tagiem semver bez 'v': ${FALLBACK_TAG}..."
    export LOUEZ_IMAGE_TAG="${FALLBACK_TAG}"
    docker compose pull louez background-removal
    TARGET_TAG="${FALLBACK_TAG}"
  elif [[ "${TARGET_TAG}" =~ ^[0-9] ]]; then
    FALLBACK_TAG="v${TARGET_TAG}"
    log "⚠️ Nie znaleziono tagu ${TARGET_TAG} na GHCR. Próbuję z prefiksem 'v': ${FALLBACK_TAG}..."
    export LOUEZ_IMAGE_TAG="${FALLBACK_TAG}"
    docker compose pull louez background-removal
    TARGET_TAG="${FALLBACK_TAG}"
  else
    exit 1
  fi
fi

# 3. Restart kontenerów z nowym obrazem
log "🔄 Aktualizuję kontenery..."
docker compose up -d --remove-orphans

# 4. Healthcheck - weryfikacja czy aplikacja wstała poprawnie
log "🩺 Sprawdzam stan aplikacji pod http://localhost:3000/api/health..."
HEALTHY=false
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health || true)
  if [ "$STATUS" = "200" ]; then
    log "✅ Aplikacja działa poprawnie (HTTP 200 OK)"
    HEALTHY=true
    break
  fi
  log "Oczekiwanie na gotowość aplikacji... próba $i/30 (status: $STATUS)"
  sleep 2
done

if [ "$HEALTHY" != "true" ]; then
  log "❌ BŁĄD: Aplikacja nie zgłosiła statusu 200 w ciągu 60 sekund!"
  log "Dumping ostatnich logów kontenera:"
  docker compose logs louez --tail 50
  exit 1
fi

# 5. Bezpieczne czyszczenie nieużywanych, osieroconych obrazów
log "🧹 Czyszczenie nieużywanych warstw obrazów..."
docker image prune -f

log "🎉 Wdrożenie wersji ${TARGET_TAG} zakończone sukcesem!"

