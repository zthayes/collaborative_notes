import { query, withTransaction } from "../db/pool.js";

export async function getNoteAccess(noteId, userId) {
  const result = await query(
    `SELECT
       n.id,
       n.owner_id,
       n.title,
       n.content,
       n.revision,
       n.created_at,
       n.updated_at,
       CASE
         WHEN n.owner_id = $2 THEN 'owner'
         ELSE ns.role
       END AS role
     FROM notes n
     LEFT JOIN note_shares ns
       ON ns.note_id = n.id AND ns.user_id = $2
     WHERE n.id = $1
       AND (n.owner_id = $2 OR ns.user_id = $2)`,
    [noteId, userId]
  );

  return result.rows[0] ?? null;
}

export async function listNotes(userId, search = "") {
  const result = await query(
    `SELECT
       n.id,
       n.owner_id,
       n.title,
       n.content,
       n.revision,
       n.created_at,
       n.updated_at,
       CASE
         WHEN n.owner_id = $1 THEN 'owner'
         ELSE ns.role
       END AS role
     FROM notes n
     LEFT JOIN note_shares ns
       ON ns.note_id = n.id AND ns.user_id = $1
     WHERE (n.owner_id = $1 OR ns.user_id = $1)
       AND (
         $2 = ''
         OR n.title ILIKE '%' || $2 || '%'
         OR n.content ILIKE '%' || $2 || '%'
       )
     ORDER BY n.updated_at DESC`,
    [userId, search]
  );

  return result.rows;
}

export async function createNote(userId, title, content) {
  const result = await query(
    `INSERT INTO notes (owner_id, title, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, title, content]
  );

  return { ...result.rows[0], role: "owner" };
}

export async function updateNote(noteId, userId, data) {
  return withTransaction(async (client) => {
    const access = await client.query(
      `SELECT
         n.id,
         n.revision,
         CASE
           WHEN n.owner_id = $2 THEN 'owner'
           ELSE ns.role
         END AS role
       FROM notes n
       LEFT JOIN note_shares ns
         ON ns.note_id = n.id AND ns.user_id = $2
       WHERE n.id = $1
         AND (n.owner_id = $2 OR ns.user_id = $2)
       FOR UPDATE OF n`,
      [noteId, userId]
    );

    const current = access.rows[0];

    if (!current) {
      return { kind: "not_found" };
    }

    if (!["owner", "editor"].includes(current.role)) {
      return { kind: "forbidden" };
    }

    if (current.revision !== data.revision) {
      const latest = await client.query(
        `SELECT
           n.*,
           CASE
             WHEN n.owner_id = $2 THEN 'owner'
             ELSE ns.role
           END AS role
         FROM notes n
         LEFT JOIN note_shares ns
           ON ns.note_id = n.id AND ns.user_id = $2
         WHERE n.id = $1`,
        [noteId, userId]
      );

      return { kind: "conflict", note: latest.rows[0] };
    }

    const updated = await client.query(
      `UPDATE notes
       SET title = $1,
           content = $2,
           revision = revision + 1,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [data.title, data.content, noteId]
    );

    return {
      kind: "updated",
      note: { ...updated.rows[0], role: current.role }
    };
  });
}

export async function deleteNote(noteId, userId) {
  const result = await query(
    `DELETE FROM notes
     WHERE id = $1 AND owner_id = $2
     RETURNING id`,
    [noteId, userId]
  );

  return result.rowCount > 0;
}

export async function shareNote(noteId, ownerId, email, role) {
  return withTransaction(async (client) => {
    const note = await client.query(
      `SELECT id FROM notes WHERE id = $1 AND owner_id = $2`,
      [noteId, ownerId]
    );

    if (!note.rows[0]) {
      return { kind: "not_found" };
    }

    const user = await client.query(
      `SELECT id, name, email FROM users WHERE email = $1`,
      [email.trim().toLowerCase()]
    );

    if (!user.rows[0]) {
      return { kind: "user_not_found" };
    }

    if (user.rows[0].id === ownerId) {
      return { kind: "self" };
    }

    const result = await client.query(
      `INSERT INTO note_shares (note_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (note_id, user_id)
       DO UPDATE SET role = EXCLUDED.role
       RETURNING note_id, user_id, role`,
      [noteId, user.rows[0].id, role]
    );

    return {
      kind: "shared",
      share: {
        ...result.rows[0],
        user: user.rows[0]
      }
    };
  });
}

export async function removeShare(noteId, ownerId, userId) {
  const result = await query(
    `DELETE FROM note_shares
     WHERE note_id = $1
       AND user_id = $2
       AND EXISTS (
         SELECT 1 FROM notes
         WHERE notes.id = $1 AND notes.owner_id = $3
       )
     RETURNING user_id`,
    [noteId, userId, ownerId]
  );

  return result.rowCount > 0;
}

export async function listShares(noteId, userId) {
  const owner = await query(
    `SELECT owner_id FROM notes WHERE id = $1`,
    [noteId]
  );

  if (!owner.rows[0] || owner.rows[0].owner_id !== userId) {
    return null;
  }

  const result = await query(
    `SELECT ns.user_id, ns.role, u.name, u.email
     FROM note_shares ns
     JOIN users u ON u.id = ns.user_id
     WHERE ns.note_id = $1
     ORDER BY u.name`,
    [noteId]
  );

  return result.rows;
}
