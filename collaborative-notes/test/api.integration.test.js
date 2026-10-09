import "dotenv/config";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { pool } from "../src/db/pool.js";

let server;
let baseUrl;
let owner;
let editor;
let viewer;
let note;
let dbAvailable = false;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

function integration(name, fn) {
  test(name, async t => {
    if (!dbAvailable) {
      t.skip("PostgreSQL is not available");
      return;
    }
    await fn();
  });
}

async function register(name, email) {
  const result = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password: "password123" })
  });

  assert.equal(result.response.status, 201);
  return result.data;
}

before(async () => {
  try {
    await pool.query("SELECT 1");
    dbAvailable = true;
  } catch {
    console.warn("Integration tests skipped: PostgreSQL is not available.");
    return;
  }

  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  owner = await register("Owner", `owner-${suffix}@example.com`);
  editor = await register("Editor", `editor-${suffix}@example.com`);
  viewer = await register("Viewer", `viewer-${suffix}@example.com`);
});

after(async () => {
  if (!dbAvailable) {
    await pool.end();
    return;
  }

  if (note?.id && owner?.user?.id) {
    await pool.query("DELETE FROM notes WHERE id = $1", [note.id]);
  }

  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

integration("health endpoint returns a successful response", async () => {
  const { response, data } = await request("/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(data, { status: "ok" });
});

integration("registration rejects duplicate email addresses", async () => {
  const { response, data } = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Duplicate",
      email: owner.user.email,
      password: "password123"
    })
  });

  assert.equal(response.status, 409);
  assert.equal(data.error, "Email is already registered");
});

integration("login rejects invalid credentials", async () => {
  const { response, data } = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: owner.user.email,
      password: "wrong-password"
    })
  });

  assert.equal(response.status, 401);
  assert.equal(data.error, "Invalid email or password");
});

integration("owner can create and read a note", async () => {
  const created = await request("/api/notes", {
    method: "POST",
    headers: auth(owner.token),
    body: JSON.stringify({ title: "Integration test", content: "Initial content" })
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.data.note.role, "owner");
  note = created.data.note;

  const fetched = await request(`/api/notes/${note.id}`, {
    headers: auth(owner.token)
  });

  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.data.note.id, note.id);
  assert.equal(fetched.data.note.content, "Initial content");
});

integration("owner can share editor and viewer access", async () => {
  const editorShare = await request(`/api/notes/${note.id}/share`, {
    method: "POST",
    headers: auth(owner.token),
    body: JSON.stringify({ email: editor.user.email, role: "editor" })
  });

  const viewerShare = await request(`/api/notes/${note.id}/share`, {
    method: "POST",
    headers: auth(owner.token),
    body: JSON.stringify({ email: viewer.user.email, role: "viewer" })
  });

  assert.equal(editorShare.response.status, 201);
  assert.equal(editorShare.data.share.user.email, editor.user.email);
  assert.equal(editorShare.data.share.role, "editor");
  assert.equal(viewerShare.response.status, 201);

  const shares = await request(`/api/notes/${note.id}/shares`, {
    headers: auth(owner.token)
  });

  assert.equal(shares.response.status, 200);
  assert.equal(shares.data.shares.length, 2);
  assert.ok(shares.data.shares.every(share => share.user?.email));
});

integration("viewer can read but cannot edit", async () => {
  const fetched = await request(`/api/notes/${note.id}`, {
    headers: auth(viewer.token)
  });

  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.data.note.role, "viewer");

  const updated = await request(`/api/notes/${note.id}`, {
    method: "PATCH",
    headers: auth(viewer.token),
    body: JSON.stringify({
      title: "Unauthorized",
      content: "Should fail",
      revision: fetched.data.note.revision
    })
  });

  assert.equal(updated.response.status, 403);
});

integration("editor can update the note", async () => {
  const fetched = await request(`/api/notes/${note.id}`, {
    headers: auth(editor.token)
  });

  const updated = await request(`/api/notes/${note.id}`, {
    method: "PATCH",
    headers: auth(editor.token),
    body: JSON.stringify({
      title: "Updated by editor",
      content: "Editor content",
      revision: fetched.data.note.revision
    })
  });

  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.note.role, "editor");
  assert.equal(updated.data.note.revision, fetched.data.note.revision + 1);
  note = updated.data.note;
});

integration("stale revisions return 409 with the latest note", async () => {
  const staleRevision = note.revision - 1;

  const result = await request(`/api/notes/${note.id}`, {
    method: "PATCH",
    headers: auth(owner.token),
    body: JSON.stringify({
      title: "Stale update",
      content: "Should conflict",
      revision: staleRevision
    })
  });

  assert.equal(result.response.status, 409);
  assert.equal(result.data.note.revision, note.revision);
  assert.equal(result.data.note.content, note.content);
});

integration("editor cannot change sharing settings", async () => {
  const result = await request(`/api/notes/${note.id}/share`, {
    method: "POST",
    headers: auth(editor.token),
    body: JSON.stringify({ email: owner.user.email, role: "viewer" })
  });

  assert.equal(result.response.status, 404);
});

integration("owner can remove a share and removed users lose access", async () => {
  const removed = await request(`/api/notes/${note.id}/share/${viewer.user.id}`, {
    method: "DELETE",
    headers: auth(owner.token)
  });

  assert.equal(removed.response.status, 204);

  const fetched = await request(`/api/notes/${note.id}`, {
    headers: auth(viewer.token)
  });

  assert.equal(fetched.response.status, 404);
});

integration("only the owner can delete the note", async () => {
  const editorDelete = await request(`/api/notes/${note.id}`, {
    method: "DELETE",
    headers: auth(editor.token)
  });

  assert.equal(editorDelete.response.status, 404);

  const ownerDelete = await request(`/api/notes/${note.id}`, {
    method: "DELETE",
    headers: auth(owner.token)
  });

  assert.equal(ownerDelete.response.status, 204);
  note = null;
});
