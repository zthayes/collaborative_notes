import express from "express";
import cors from "cors";
import authRoutes from "./auth/auth.routes.js";
import notesRoutes from "./notes/notes.routes.js";

export const app = express();

app.use(cors({
  origin: process.env.CLIENT_ORIGIN?.split(",") ?? "*"
}));

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/notes", notesRoutes);

app.use((error, _req, res, _next) => {
  if (error.name === "ZodError") {
    return res.status(400).json({
      error: "Validation failed",
      details: error.issues
    });
  }

  console.error(error);

  res.status(500).json({
    error: "Internal server error"
  });
});
