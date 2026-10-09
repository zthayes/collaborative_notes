# Collaborative Notes REST API

A full-stack collaborative note-taking application centered around a **runnable REST API**. The included React client demonstrates the API and real-time collaboration behavior, but the REST service is the primary deliverable.

The project is intentionally designed to make its correctness and tradeoffs easy to review: authentication and authorization are explicit, writes use PostgreSQL transactions, updates use optimistic concurrency control, inputs are validated with Zod, and the API is covered by integration tests.

## Architecture

```mermaid
flowchart TD
    Client[React demonstration client] -->|HTTP REST| API[Express API]
    Client -->|Socket.IO| API
    API --> Auth[JWT authentication]
    API --> Notes[Notes and sharing services]
    Notes -->|Parameterized SQL / transactions| DB[(PostgreSQL)]
    API -->|Canonical note updates| Client
```

### Project structure

```text
collaborative-notes/
├── src/
│   ├── auth/             # Registration, login, current-user endpoint
│   ├── db/               # PostgreSQL pool and transaction helper
│   ├── middleware/       # JWT authentication
│   ├── notes/            # Note and sharing API/service logic
│   ├── realtime/         # Socket.IO connection and room handling
│   ├── app.js            # Express application
│   └── server.js         # HTTP + Socket.IO server bootstrap
├── migrations/           # Database schema migrations
├── scripts/              # Migration runner
├── test/                 # API integration tests
├── client/               # React demonstration client
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Design decisions and tradeoffs

### Node.js + Express

Express keeps the REST layer small and explicit. The application does not require a large framework abstraction, so routes, validation, authorization, and database calls are easy to inspect.

### PostgreSQL

Users, notes, ownership, and note sharing have clear relational relationships. PostgreSQL provides foreign keys, uniqueness constraints, transactions, and row-level locking that fit the consistency requirements well.

### Raw SQL instead of an ORM

The data model is small enough that an ORM would add abstraction without much benefit. Parameterized SQL keeps the important queries and transaction boundaries visible to a reviewer.

### JWT authentication

JWTs provide stateless authentication for the REST API and are straightforward for the included browser client. Tokens expire after seven days.

### Authorization model

Authorization is enforced on the server for every protected operation. The client hides controls for convenience, but the API is the security boundary.

| Role | Read | Write | Share | Delete |
|---|---:|---:|---:|---:|
| Owner | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | No | No |
| Viewer | Yes | No | No | No |
| Unauthenticated | No | No | No | No |

### Optimistic concurrency with revisions

Each note has a monotonically increasing `revision`. A client must submit the revision it last read when updating a note. The server locks the note inside a transaction, verifies the revision, updates the note, and increments the revision atomically.

If another write happened first, the API returns `409 Conflict` and includes the current note.

This was chosen instead of CRDT/OT because the assignment prioritizes a reliable, understandable REST service rather than character-level simultaneous editing. It gives deterministic conflict detection without introducing the complexity of a distributed text-editing algorithm.

### REST as the source of truth; Socket.IO as notification

The REST `PATCH` endpoint performs the authoritative database update. Only after that succeeds does the server broadcast the resulting canonical note through Socket.IO.

This prevents clients from being able to invent a WebSocket update that was never persisted. Socket.IO is therefore an optional real-time delivery mechanism, not a second write path.

## API

All endpoints below are relative to `http://localhost:3000`.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | No | Service health check |
| POST | `/api/auth/register` | No | Register a user |
| POST | `/api/auth/login` | No | Authenticate and receive a JWT |
| GET | `/api/auth/me` | Yes | Return the current user |
| GET | `/api/notes` | Yes | List notes the user can access |
| POST | `/api/notes` | Yes | Create a note |
| GET | `/api/notes/:id` | Yes | Get a note |
| PATCH | `/api/notes/:id` | Owner/Editor | Update a note |
| DELETE | `/api/notes/:id` | Owner | Delete a note |
| GET | `/api/notes/:id/shares` | Owner | List sharing settings |
| POST | `/api/notes/:id/share` | Owner | Add or change a user's access |
| DELETE | `/api/notes/:id/share/:userId` | Owner | Remove a user's access |

### HTTP status conventions

- `200 OK` — successful read or update
- `201 Created` — successful creation
- `204 No Content` — successful deletion
- `400 Bad Request` — invalid request data
- `401 Unauthorized` — missing or invalid authentication
- `403 Forbidden` — authenticated but not permitted for the operation
- `404 Not Found` — resource is unavailable to the requesting user
- `409 Conflict` — revision conflict or duplicate registration
- `500 Internal Server Error` — unexpected server failure

## Runnable setup

### Requirements

- Node.js 20+
- npm 10+
- Docker Desktop with Docker Compose

### Recommended: Docker PostgreSQL + local Node

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Start PostgreSQL:

```bash
docker compose up -d postgres
```

3. Install dependencies:

```bash
npm install
cd client && npm install && cd ..
```

4. Run migrations:

```bash
npm run migrate
```

5. Start the API:

```bash
npm run dev
```

The REST service is available at `http://localhost:3000`.

6. To run the demonstration client in another terminal:

```bash
npm run client:dev
```

The React client is available at `http://localhost:5173`.

### Fully containerized API + PostgreSQL

After creating `.env`, the complete backend can also be started with:

```bash
docker compose up --build
```

The API container waits for PostgreSQL to become healthy, applies pending migrations, and starts the REST service on port `3000`.

## Environment

Example `.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/collaborative_notes
JWT_SECRET=replace-this-with-a-long-random-secret
PORT=3000
CLIENT_ORIGIN=http://localhost:5173
```

Never commit `.env`. The repository includes `.env.example` for configuration documentation.

## API walkthrough

### 1. Register

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "email": "alice@example.com",
    "password": "password123"
  }'
```

The response contains a JWT. Save it as `TOKEN` for subsequent requests.

### 2. Create a note

```bash
curl -X POST http://localhost:3000/api/notes \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Note",
    "content": "Hello world"
  }'
```

### 3. List notes

```bash
curl http://localhost:3000/api/notes \
  -H "Authorization: Bearer TOKEN"
```

### 4. Update a note

```bash
curl -X PATCH http://localhost:3000/api/notes/NOTE_ID \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated title",
    "content": "Updated content",
    "revision": 0
  }'
```

The revision must match the current server revision. A stale revision produces `409 Conflict` with the latest note.

### 5. Share a note

```bash
curl -X POST http://localhost:3000/api/notes/NOTE_ID/share \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "person@example.com",
    "role": "editor"
  }'
```

## Testing

The integration suite exercises the running Express application against PostgreSQL, including:

- health checks
- registration and duplicate-email handling
- login failure handling
- note creation and reads
- owner/editor/viewer authorization
- sharing and share listing
- removal of access
- editor updates
- stale revision conflicts
- owner-only deletion

Start PostgreSQL and configure `.env`, then run:

```bash
npm test
```

## Real-time collaboration

Clients join a Socket.IO room for each note:

```text
note:{noteId}
```

When an editor saves a note:

1. The client sends a REST `PATCH` request.
2. The server authenticates and authorizes the user.
3. PostgreSQL locks the note within a transaction.
4. The server verifies the submitted revision.
5. PostgreSQL updates the note and increments the revision atomically.
6. The REST response returns the canonical note.
7. The server broadcasts that canonical note to the note's Socket.IO room.

Clients never use Socket.IO as an alternate write API.

## Scope

The project intentionally focuses on the requested REST-service concerns: API correctness, persistence, authentication, authorization, concurrency, validation, testing, and clear documentation. The React client and Socket.IO layer demonstrate the API and real-time behavior without changing the REST service's source-of-truth model.
