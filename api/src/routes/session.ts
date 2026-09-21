import express, { Router, type Request, type Response } from "express";
import {
  COOKIE_NAME,
  FailLimiter,
  normalizeUsername,
  parseCookies,
  validateUsername,
} from "../auth";
import type { Deps } from "../deps";

/** Herkese açık uçlar: sağlık, giriş, çıkış. */
export function publicRoutes(d: Deps): Router {
  const r = Router();
  const ipLimiter = new FailLimiter(8, 15 * 60 * 1000); // aynı IP: 15 dk'da 8 hatalı deneme
  const userLimiter = new FailLimiter(20, 15 * 60 * 1000); // aynı kullanıcı adı: 15 dk'da 20 (dağıtık saldırı)

  const cookieOpts = (req: Request) => ({
    httpOnly: true,
    sameSite: "strict" as const,
    secure: req.secure,
    path: "/",
  });

  r.get("/health", async (_req, res) => {
    try {
      await d.pool.query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  r.post("/login", express.json({ limit: "2kb" }), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    const ipKey = "ip:" + req.ip;
    const userKey = "u:" + username;

    const wait = Math.max(ipLimiter.retryAfterSec(ipKey), userLimiter.retryAfterSec(userKey));
    if (wait > 0) {
      res.set("Retry-After", String(wait));
      res.status(429).json({ error: "Çok fazla hatalı deneme. " + Math.ceil(wait / 60) + " dakika sonra tekrar deneyin." });
      return;
    }
    if (!validateUsername(username) || !password || password.length > 200) {
      ipLimiter.fail(ipKey);
      res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
      return;
    }
    try {
      const user = await d.auth.authenticate(username, password);
      if (!user) {
        ipLimiter.fail(ipKey);
        userLimiter.fail(userKey);
        res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
        return;
      }
      ipLimiter.clear(ipKey);
      userLimiter.clear(userKey);
      const token = await d.auth.createSession(user.id);
      res.cookie(COOKIE_NAME, token, { ...cookieOpts(req), maxAge: d.auth.absoluteMs });
      res.json({ ok: true, username: user.username });
    } catch (e) {
      console.error("Giriş hatası:", e);
      res.status(500).json({ error: "Sunucu hatası." });
    }
  });

  r.post("/logout", async (req, res) => {
    await d.auth.destroySession(parseCookies(req.headers.cookie)[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME, cookieOpts(req));
    res.json({ ok: true });
  });

  return r;
}
