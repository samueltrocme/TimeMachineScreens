# TimeMachine Screens (Node.js + iPad + Arduino)

Mini site Node.js pour un escape game "machine a voyager dans le temps", avec:

- ecran `Liquide` synchronise par niveau d'energie (0-100),
- ecran `Engrenage` synchronise par etape de sequence (0-6),
- API HTTP pour recevoir les updates Arduino,
- ecoute du port USB serie Arduino (JSON ligne par ligne),
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

### Diagnostic serie

`GET /api/serial-status`

Retourne:

- etat de connexion serie (`connected`, `activePath`, `desiredPath`),
- configuration active (`baudRate`, `reconnectMs`, `historyLimit`),
- compteurs (`received`, `accepted`, `rejected`),
- dernier message/erreur,
- historique des derniers messages recus.

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

## 6) Ecoute serie USB Arduino (JSON)

Le serveur peut se mettre a jour via les logs serie Arduino en plus de l'API HTTP.

Formats attendus (une ligne JSON par message):

```json
{"type":"energy","energyPercent":67,"source":"arduino","updatedAtMs":1710000000000}
{"type":"sequence","sequenceStep":4,"source":"arduino","updatedAtMs":1710000001000}
```

Regles:

- `type: "energy"` met a jour uniquement `energyPercent`.
- `type: "sequence"` met a jour uniquement `sequenceStep`.
- `updatedAtMs` est optionnel (si absent, le serveur met l'heure courante).
- `source` est optionnel.
- Le serveur reconnecte automatiquement le port serie en cas de deconnexion.

Variables d'environnement serie:

- `SERIAL_ENABLED` (defaut: `true`)
- `SERIAL_PORT_PATH` (defaut: auto-detection, ex: `/dev/ttyACM0`)
- `SERIAL_BAUD_RATE` (defaut: `115200`)
- `SERIAL_RECONNECT_MS` (defaut: `3000`)
- `SERIAL_HISTORY_LIMIT` (defaut: `100`)

## 7) Docker

### Build

```bash
docker build -t timemachine-screens:latest .
```

### Run

```bash
docker run -d \
  --name timemachine-screens \
  -p 3000:3000 \
  --device /dev/ttyACM0:/dev/ttyACM0 \
  -e SERIAL_PORT_PATH=/dev/ttyACM0 \
  -e SERIAL_BAUD_RATE=115200 \
  --restart unless-stopped \
  timemachine-screens:latest
```

Si le nom de device est different (`/dev/ttyUSB0` par exemple), adapte `--device` et `SERIAL_PORT_PATH`.

Puis ouvrir:

- `http://<raspberry-ip>:3000/liquide`
- `http://<raspberry-ip>:3000/engrenage`
- `http://<raspberry-ip>:3000/demo`

## 8) Notes assets visuels

Les pages web utilisent les assets suivants:

- `Liquide/final.mp4`
- `Engrenage/fond_sans_engrenages.jpg`
- `Engrenage/gear0.png` ... `Engrenage/gear4.png`

Le serveur expose directement les dossiers `Liquide/` et `Engrenage/` pour conserver la compatibilite des visuels existants.

## 9) Conseils exploitation continue (Raspberry + reseau interne)

- Donner une IP fixe au Raspberry sur le wifi interne.
- Faire pointer l'Arduino vers `http://<raspberry-ip>:3000/api/update`.
- Brancher l'Arduino en USB et verifier le port (`/dev/ttyACM0` ou `/dev/ttyUSB0`).
- Activer `--restart unless-stopped` sur le conteneur Docker.
- Superviser la disponibilite via `GET /api/state` (healthcheck simple).
