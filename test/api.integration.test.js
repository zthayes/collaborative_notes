import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../src/app.js";
import { pool } from "../src/db/pool.js";

let owner;
let editor;
let viewer;
let note;

await pool.query("SELECT 1");

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function register(name, email) {
  const response = await request(app)
    .post("/api/auth/register")
    .send({
      name,
      email,
      password: "password123"
    });

  assert.equal(response.status, 201);

  return response.body;
}

function auth(token) {
  return {
    Authorization: `Bearer ${token}`
  };
}

owner = await register(
  "Owner",
  `owner-${suffix}@example.com`
);

editor = await register(
  "Editor",
  `editor-${suffix}@example.com`
);

viewer = await register(
  "Viewer",
  `viewer-${suffix}@example.com`
);

test("health endpoint returns a successful response", async () => {
  const response = await request(app)
    .get("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    status: "ok"
  });
});

test("registration rejects duplicate email addresses", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Duplicate",
      email: owner.user.email,
      password: "password123"
    });

  assert.equal(response.status, 409);
  assert.equal(response.body.error, "Email is already registered");
});

test("login rejects invalid credentials", async () => {
  const response = await request(app)
    .post("/api/auth/login")
    .send({
      email: owner.user.email,
      password: "wrong-password"
    });

  assert.equal(response.status, 401);
  assert.equal(response.body.error, "Invalid email or password");
});

test("owner can create and read a note", async () => {
  const created = await request(app)
    .post("/api/notes")
    .set(auth(owner.token))
    .send({
      title: "Integration test",
      content: "Initial content"
    });

  assert.equal(created.status, 201);
  assert.equal(created.body.note.role, "owner");

  note = created.body.note;

  const fetched = await request(app)
    .get(`/api/notes/${note.id}`)
    .set(auth(owner.token));

  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.note.id, note.id);
  assert.equal(fetched.body.note.content, "Initial content");
});

test("owner can share editor and viewer access", async () => {
  const editorShare = await request(app)
    .post(`/api/notes/${note.id}/share`)
    .set(auth(owner.token))
    .send({
      email: editor.user.email,
      role: "editor"
    });

  const viewerShare = await request(app)
    .post(`/api/notes/${note.id}/share`)
    .set(auth(owner.token))
    .send({
      email: viewer.user.email,
      role: "viewer"
    });

  assert.equal(editorShare.status, 201);
  assert.equal(
    editorShare.body.share.user.email,
    editor.user.email
  );
  assert.equal(editorShare.body.share.role, "editor");

  assert.equal(viewerShare.status, 201);

  const shares = await request(app)
    .get(`/api/notes/${note.id}/shares`)
    .set(auth(owner.token));

  assert.equal(shares.status, 200);
  assert.equal(shares.body.shares.length, 2);

  assert.ok(
    shares.body.shares.every(
      share => share.user?.email
    )
  );
});

test("viewer can read but cannot edit", async () => {
  const fetched = await request(app)
    .get(`/api/notes/${note.id}`)
    .set(auth(viewer.token));

  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.note.role, "viewer");

  const updated = await request(app)
    .patch(`/api/notes/${note.id}`)
    .set(auth(viewer.token))
    .send({
      title: "Unauthorized",
      content: "Should fail",
      revision: fetched.body.note.revision
    });

  assert.equal(updated.status, 403);
});

test("editor can update the note", async () => {
  const fetched = await request(app)
    .get(`/api/notes/${note.id}`)
    .set(auth(editor.token));

  const updated = await request(app)
    .patch(`/api/notes/${note.id}`)
    .set(auth(editor.token))
    .send({
      title: "Updated by editor",
      content: "Editor content",
      revision: fetched.body.note.revision
    });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.note.role, "editor");

  assert.equal(
    updated.body.note.revision,
    fetched.body.note.revision + 1
  );

  note = updated.body.note;
});

test("stale revisions return 409 with the latest note", async () => {
  const staleRevision = note.revision - 1;

  const result = await request(app)
    .patch(`/api/notes/${note.id}`)
    .set(auth(owner.token))
    .send({
      title: "Stale update",
      content: "Should conflict",
      revision: staleRevision
    });

  assert.equal(result.status, 409);
  assert.equal(
    result.body.note.revision,
    note.revision
  );
  assert.equal(
    result.body.note.content,
    note.content
  );
});

test("editor cannot change sharing settings", async () => {
  const result = await request(app)
    .post(`/api/notes/${note.id}/share`)
    .set(auth(editor.token))
    .send({
      email: owner.user.email,
      role: "viewer"
    });

  assert.equal(result.status, 404);
});

test("owner can remove a share and removed users lose access", async () => {
  const removed = await request(app)
    .delete(`/api/notes/${note.id}/share/${viewer.user.id}`)
    .set(auth(owner.token));

  assert.equal(removed.status, 204);

  const fetched = await request(app)
    .get(`/api/notes/${note.id}`)
    .set(auth(viewer.token));

  assert.equal(fetched.status, 404);
});

test("only the owner can delete the note", async () => {
  const editorDelete = await request(app)
    .delete(`/api/notes/${note.id}`)
    .set(auth(editor.token));

  assert.equal(editorDelete.status, 404);

  const ownerDelete = await request(app)
    .delete(`/api/notes/${note.id}`)
    .set(auth(owner.token));

  assert.equal(ownerDelete.status, 204);

  note = null;
});

after(async () => {
  if (note?.id) {
    await pool.query(
      "DELETE FROM notes WHERE id = $1",
      [note.id]
    );
  }

  await pool.end();
});