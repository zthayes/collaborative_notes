import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import {
  listNotes,
  createNote,
  getNoteAccess,
  updateNote,
  deleteNote,
  shareNote,
  removeShare,
  listShares
} from "./notes.service.js";

const router = Router();

const noteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(200000)
});

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : "";
    res.json({ notes: await listNotes(req.user.sub, search) });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = noteSchema.parse(req.body);
    res.status(201).json({
      note: await createNote(req.user.sub, data.title, data.content)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const note = await getNoteAccess(req.params.id, req.user.sub);

    if (!note) {
      return res.status(404).json({ error: "Note not found" });
    }

    res.json({ note });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const data = noteSchema.extend({
      revision: z.number().int().nonnegative()
    }).parse(req.body);

    const result = await updateNote(req.params.id, req.user.sub, data);

    if (result.kind === "not_found") {
      return res.status(404).json({ error: "Note not found" });
    }

    if (result.kind === "forbidden") {
      return res.status(403).json({ error: "You do not have edit permission" });
    }

    if (result.kind === "conflict") {
      return res.status(409).json({
        error: "Note was changed by another user",
        note: result.note
      });
    }

    res.json({ note: result.note });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deleteNote(req.params.id, req.user.sub);

    if (!deleted) {
      return res.status(404).json({ error: "Note not found or you are not the owner" });
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/:id/shares", async (req, res, next) => {
  try {
    const shares = await listShares(req.params.id, req.user.sub);

    if (!shares) {
      return res.status(403).json({ error: "Only the owner can view sharing settings" });
    }

    res.json({ shares });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/share", async (req, res, next) => {
  try {
    const data = z.object({
      email: z.string().email(),
      role: z.enum(["viewer", "editor"])
    }).parse(req.body);

    const result = await shareNote(
      req.params.id,
      req.user.sub,
      data.email,
      data.role
    );

    if (result.kind === "not_found") {
      return res.status(404).json({ error: "Note not found" });
    }

    if (result.kind === "user_not_found") {
      return res.status(404).json({ error: "That user does not exist" });
    }

    if (result.kind === "self") {
      return res.status(400).json({ error: "The owner already has access" });
    }

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/share/:userId", async (req, res, next) => {
  try {
    const removed = await removeShare(
      req.params.id,
      req.user.sub,
      req.params.userId
    );

    if (!removed) {
      return res.status(404).json({ error: "Share not found" });
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
