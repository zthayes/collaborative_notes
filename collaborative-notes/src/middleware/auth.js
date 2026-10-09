import jwt from "jsonwebtoken";

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    req.user = jwt.verify(
      header.slice("Bearer ".length),
      process.env.JWT_SECRET
    );
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
