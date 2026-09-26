# HabitTrack API

API du **projet final** du cours « Tasky Web : De Flutter au Web ». Vous construisez seul **HabitTrack Web**, une application de suivi d'habitudes ; cette API en est le backend.

Elle reprend l'authentification de TaskyAPI (vérification de l'e-mail par code, jeton d'accès, refresh token en cookie `HttpOnly` avec rotation), et ajoute les habitudes et leurs validations quotidiennes.

> Elle peut tourner **en même temps** que TaskyAPI : ses ports sont décalés (API sur 3001, Mailpit sur 8026, PostgreSQL sur 5433) et son cookie a un autre nom (`habittrack_refresh`).

---

## Démarrer en une commande

Prérequis : [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
git clone https://github.com/PrinceLeBon/habittrack-api.git
cd habittrack-api
docker compose up --build
```

| Service | Adresse |
|---|---|
| API | http://localhost:3001 |
| Documentation Swagger (testable) | http://localhost:3001/docs |
| Contrat OpenAPI (JSON) | http://localhost:3001/docs-json (copie dans `docs/openapi.json`) |
| Boîte mail de développement (Mailpit) | http://localhost:8026 |
| État de l'API | http://localhost:3001/health |

**Compte de démonstration** (vérifié, avec trois habitudes actives, une archivée, et 60 jours d'historique pour tester vos statistiques) : `demo@habittrack.dev` / `HabitTrack2026!`

```bash
docker compose down      # arrêter (les données sont conservées)
docker compose down -v   # arrêter ET effacer la base
```

---

## Le contrat

Format d'erreur, commun à toutes les routes :

```json
{ "statusCode": 400, "message": ["name must be longer than or equal to 3 characters"], "error": "Bad Request", "path": "/habits", "timestamp": "…" }
```

`message` est une chaîne, ou un tableau pour les erreurs de validation. Tout champ inconnu est refusé (400).

### Authentification

Identique à TaskyAPI :

| Route | Rôle |
|---|---|
| `POST /auth/register` `{ name, email, password }` | 201 : l'utilisateur, **sans jeton** ; un code à 6 chiffres est envoyé par e-mail (Mailpit). 409 si l'e-mail existe. |
| `POST /auth/verify-otp` `{ email, code }` / `POST /auth/resend-otp` `{ email }` | Vérification de l'adresse. |
| `POST /auth/login` `{ email, password }` | 200 : `{ access_token, token_type, user }`. 401, **403 si l'e-mail n'est pas vérifié**, 429 au-delà de 5 tentatives par minute. |
| `POST /auth/refresh` | 200 : même forme, avec **rotation** du refresh token. |
| `POST /auth/logout` | 204 : session révoquée. |
| `GET /auth/me` | L'utilisateur connecté. |

Avec l'en-tête `X-Token-Transport: cookie` (clients web), le refresh token est placé dans le cookie `habittrack_refresh` (`HttpOnly`, `SameSite=Strict`, `Path=/auth`) et absent du corps. Les requêtes `/auth/*` doivent alors partir avec `credentials: 'include'`.

### Habitudes

Toutes les routes exigent `Authorization: Bearer <access_token>`. 404 si l'habitude n'existe pas, puis 403 si elle appartient à un autre utilisateur.

| Route | Détail |
|---|---|
| `GET /habits?archived=true\|false` | La liste (non paginée), filtre facultatif. |
| `GET /habits/:id` | Une habitude. |
| `POST /habits` | Créer. **Idempotent** si `clientId` (UUID) est fourni. |
| `PATCH /habits/:id` | Modifier partiellement ; archiver avec `{ "archived": true }`. `null` efface `description`. |
| `DELETE /habits/:id` | Supprimer l'habitude **et ses validations** ; renvoie l'habitude supprimée. |

Une habitude :

```json
{
  "id": 3,
  "clientId": null,
  "name": "Faire du sport",
  "description": "Course ou renforcement",
  "frequency": "WEEKLY",
  "timesPerWeek": 3,
  "color": "emerald",
  "startDate": "2026-07-28",
  "archived": false,
  "userId": 1,
  "createdAt": "2026-09-26T13:30:00.000Z",
  "updatedAt": "2026-09-26T13:30:00.000Z"
}
```

Règles : `name` de 3 à 60 caractères ; `description` ≤ 500 ; `frequency` vaut `DAILY` (par défaut) ou `WEEKLY` ; `timesPerWeek` (1 à 7) est **obligatoire** pour `WEEKLY` et **interdit** pour `DAILY` ; `color` parmi `indigo`, `emerald`, `amber`, `rose`, `sky`, `violet` ; `startDate` au format `AAAA-MM-JJ`.

### Validations (les jours cochés)

| Route | Détail |
|---|---|
| `GET /checkins?from=AAAA-MM-JJ&to=AAAA-MM-JJ` | Les jours validés de **toutes** vos habitudes sur la période (366 jours au plus) : `[{ habitId, date }]`, triés par date. |
| `PUT /habits/:id/checkins/:date` | Valider un jour. **Idempotent** : valider deux fois ne crée qu'une validation. 200 : `{ habitId, date }`. |
| `DELETE /habits/:id/checkins/:date` | Dé-valider un jour. **Idempotent**. 204. |

Refusés (400) : une date mal formée, un jour **futur** (avec une tolérance d'un jour, car « aujourd'hui » chez l'utilisateur peut être « demain » en UTC), un jour antérieur à `startDate`.

> La règle « on ne peut cocher que jusqu'à 7 jours en arrière » du cahier des charges est une règle **d'interface** : c'est à HabitTrack Web de l'appliquer. Les statistiques (séries, taux de réussite, graphiques) se calculent **côté client**, à partir de `GET /checkins` : c'est une partie de votre projet.

---

## Développer sans Docker

Node.js 20.19 ou plus récent, et un PostgreSQL accessible.

```bash
cp .env.example .env          # adaptez DATABASE_URL
npm install
npx prisma migrate deploy
npm run seed
npm run start:dev             # PORT=3001 dans .env pour garder le même port qu'avec Docker
npm run test:e2e              # 16 tests de bout en bout
```

## Licence

MIT
