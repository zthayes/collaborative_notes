import "dotenv/config";
import http from "node:http";
import { Server } from "socket.io";
import { app } from "./app.js";
import { configureSocket } from "./realtime/socket.js";
import { pool } from "./db/pool.js";

const port = Number(process.env.PORT || 3000);
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN?.split(",") ?? "*"
  }
});

configureSocket(io);
app.locals.io = io;

server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

async function shutdown() {
  console.log("Shutting down...");
  await pool.end();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
