# TimeMachine Screens (Node.js + iPad + Arduino)

Mini site Node.js pour un escape game "machine a voyager dans le temps", avec:

- ecran `Liquide` synchronise par niveau d'energie (0-100),
- ecran `Engrenage` synchronise par etape de sequence (0-6),
- API HTTP pour recevoir les updates Arduino,
- diffusion temps reel fiable vers les iPad via SSE,
- page `Demo` de secours pour piloter l'etat sans Arduino.

## 1) Prerequis

- Node.js 20+
- npm
- (optionnel) Docker

## 2) Installation locale

```bash
npm install
npm start
```

Le serveur demarre par defaut sur `http://localhost:3000`.

## 3) Routes web

- `GET /` : page d'accueil (liens rapides)
- `GET /liquide` : ecran cuve carburant (video)
- `GET /engrenage` : ecran mecanisme engrenages
- `GET /demo` : page demo/backup Arduino

## 4) API Arduino

### Lire l'etat courant

`GET /api/state`

Exemple reponse:

```json
{
  "energyPercent": 30,
  "sequenceStep": 2,
  "source": "arduino",
  "updatedAt": "2026-03-23T10:20:30.000Z"
}
```

### Envoyer une mise a jour

`POST /api/update`

Headers:

- `Content-Type: application/json`

Payload:

- `energyPercent` (entier 0..100)
- `sequenceStep` (entier 0..6)
- `source` (optionnel, string)

Exemple:

```bash
curl -X POST http://localhost:3000/api/update \
  -H "Content-Type: application/json" \
  -d '{"energyPercent":70,"sequenceStep":4,"source":"arduino-main"}'
```

### Reinitialiser la machine

`POST /api/reset`

Exemple:

```bash
curl -X POST http://localhost:3000/api/reset \
  -H "Content-Type: application/json" \
  -d '{"source":"ops"}'
```

## 5) Flux temps reel (SSE)

- Endpoint: `GET /events`
- Chaque client iPad recoit l'etat initial puis les updates.
- Heartbeat serveur toutes les 15s pour garder la connexion active.
- Les pages ont un fallback polling sur `/api/state` si SSE devient instable.

## 6) Docker

### Build

```bash
docker build -t timemachine-screens:latest .
```

### Run

```bash
docker run -d \
  --name timemachine-screens \
  -p 3000:3000 \
  --restart unless-stopped \
  timemachine-screens:latest
```

Puis ouvrir:

- `http://<raspberry-ip>:3000/liquide`
- `http://<raspberry-ip>:3000/engrenage`
- `http://<raspberry-ip>:3000/demo`

## 7) Notes assets visuels

Les pages web utilisent les assets suivants:

- `Liquide/final.mp4`
- `Engrenage/fond_sans_engrenages.jpg`
- `Engrenage/gear0.png` ... `Engrenage/gear4.png`

Le serveur expose directement les dossiers `Liquide/` et `Engrenage/` pour conserver la compatibilite des visuels existants.

## 8) Conseils exploitation continue (Raspberry + reseau interne)

- Donner une IP fixe au Raspberry sur le wifi interne.
- Faire pointer l'Arduino vers `http://<raspberry-ip>:3000/api/update`.
- Activer `--restart unless-stopped` sur le conteneur Docker.
- Superviser la disponibilite via `GET /api/state` (healthcheck simple).
