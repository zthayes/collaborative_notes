import jwt from "jsonwebtoken";
import { getNoteAccess } from "../notes/notes.service.js";

export function configureSocket(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("note:join", async (noteId, callback) => {
      try {
        const note = await getNoteAccess(noteId, socket.user.sub);

        if (!note) {
          return callback?.({ ok: false, error: "Note not found" });
        }

        await socket.join(`note:${noteId}`);

        callback?.({ ok: true, note });
      } catch {
        callback?.({ ok: false, error: "Unable to join note" });
      }
    });

    socket.on("note:updated", async (note) => {
      try {
        const access = await getNoteAccess(note.id, socket.user.sub);

        if (!access || !["owner", "editor"].includes(access.role)) {
          return;
        }

        // Do not broadcast the sender's role. Each recipient must preserve
        // the role that applies to their own account.
        const { role: _role, ...noteUpdate } = note;
        socket.to(`note:${note.id}`).emit("note:updated", noteUpdate);
      } catch {
        // Ignore malformed client events.
      }
    });

    socket.on("note:leave", (noteId) => {
      socket.leave(`note:${noteId}`);
    });
  });
}
