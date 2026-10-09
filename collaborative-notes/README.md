# Collaborative Notes

A full-stack collaborative note-taking application built with:

- **Backend:** Node.js, Express, PostgreSQL, Socket.IO, JWT, bcrypt
- **Frontend:** React, Vite, Socket.IO client
- **Database:** PostgreSQL
- **Collaboration model:** server-authoritative note revisions with optimistic updates and revision conflict detection

## Features

- User registration and login
- JWT authentication
- Create, read, update, and delete notes
- Share notes with other registered users
- Owner/editor/viewer permissions
- Real-time note updates through WebSockets
- Revision-based conflict detection
- Search notes
- PostgreSQL migrations
- API and service tests
- Docker Compose for local development

## Requirements

- Node.js 20+
- npm 10+
- PostgreSQL 16+ (or Docker)

## Quick start with Docker

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

4. Run database migrations:

```bash
npm run migrate
```

5. Start the API:

```bash
npm run dev
```

6. In another terminal, start React:

```bash
npm run client:dev
```

Open http://localhost:5173.

## Local PostgreSQL

If you already have PostgreSQL running, configure `.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/collaborative_notes
JWT_SECRET=replace-this-with-a-long-random-secret
PORT=3000
CLIENT_ORIGIN=http://localhost:5173
```

Then:

```bash
createdb collaborative_notes
npm install
npm run migrate
npm run dev
```

## Project structure

```text
collaborative-notes/
├── src/
│   ├── auth/
│   ├── db/
│   ├── middleware/
│   ├── notes/
│   ├── realtime/
│   ├── app.js
│   └── server.js
├── migrations/
├── scripts/
├── test/
├── client/
│   └── src/
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## API

### Authentication

`POST /api/auth/register`

```json
{
  "name": "Zach",
  "email": "zach@example.com",
  "password": "password123"
}
```

`POST /api/auth/login`

Returns a JWT.

### Notes

Authenticated endpoints:

- `GET /api/notes`
- `POST /api/notes`
- `GET /api/notes/:id`
- `PATCH /api/notes/:id`
- `DELETE /api/notes/:id`

Create a note:

```json
{
  "title": "My Note",
  "content": "Hello world"
}
```

Update a note:

```json
{
  "title": "Updated title",
  "content": "Updated content",
  "revision": 3
}
```

The `revision` must match the current server revision. If another user changed the note first, the API returns `409 Conflict` with the latest note.

### Sharing

`POST /api/notes/:id/share`

```json
{
  "email": "friend@example.com",
  "role": "editor"
}
```

Roles:

- `viewer`: read-only
- `editor`: read/write
- `owner`: note owner

`DELETE /api/notes/:id/share/:userId` removes access.

## Real-time collaboration

Clients join a Socket.IO room for each note:

```text
note:{noteId}
```

When an editor saves a note, the server:

1. Validates the user's permission.
2. Checks the submitted revision.
3. Updates PostgreSQL atomically.
4. Increments the revision.
5. Broadcasts the new note to everyone else in the room.

This is intentionally simpler than a CRDT/OT editor. It provides reliable collaborative editing with conflict detection while keeping the architecture understandable and extensible.

## Testing

```bash
npm test
```

## Production considerations

Before deploying publicly, add:

- Refresh-token rotation
- Rate limiting
- Email verification/password reset
- CSRF strategy if using cookie authentication
- HTTPS
- Structured logging
- Audit history
- Automated migrations in CI/CD
- Stronger validation and content-size limits
- CRDT/OT if character-level simultaneous editing is required

## Sharing from the UI

Note owners can click **Share** in the note editor to share a note by another registered user's email address. Choose **Editor** or **Viewer** access, see the current users with access, and remove access from the same dialog.

The backend endpoint accepts email addresses directly:

```text
POST /api/notes/:id/share
{
  "email": "person@example.com",
  "role": "editor"
}
```
