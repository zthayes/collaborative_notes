import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../db/pool.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const router = Router();

const registrationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(100)
});

router.post("/register", async (req, res, next) => {
  try {
    const data = registrationSchema.parse(req.body);
    const email = data.email.toLowerCase();

    const passwordHash = await bcrypt.hash(data.password, 12);

    const result = await query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [data.name, email, passwordHash]
    );

    const user = result.rows[0];

    res.status(201).json({
      user,
      token: signToken(user)
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email is already registered" });
    }
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const data = z.object({
      email: z.string().email(),
      password: z.string().min(1)
    }).parse(req.body);

    const result = await query(
      `SELECT id, name, email, password_hash, created_at
       FROM users
       WHERE email = $1`,
      [data.email.toLowerCase()]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(data.password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    delete user.password_hash;

    res.json({
      user,
      token: signToken(user)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, email, created_at
       FROM users
       WHERE id = $1`,
      [req.user.sub]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
