"use client";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Zaten girişliyse ana sayfaya
  useEffect(() => {
    fetch("/api/me").then((r) => {
      if (r.ok) location.replace("/");
    }).catch(() => {});
  }, []);

  async function login() {
    if (!username.trim() || !password) {
      setMsg("Kullanıcı adı ve şifre gerekli.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        location.replace("/");
        return;
      }
      setMsg(data.error || "Hata: HTTP " + res.status);
      setP("");
    } catch {
      setMsg("Sunucuya ulaşılamadı.");
    }
    setBusy(false);
  }

  return (
    <div className="max-w-[380px] mx-auto mt-[12vh] px-5">
      <div className="text-center mb-[18px]">
        <h1 className="m-0 mb-1 text-[22px] font-semibold">🏷️ Künye Arşivi</h1>
        <p className="m-0 text-sm opacity-65">Devam etmek için giriş yapın.</p>
      </div>
      <div className="panel">
        <div className="search-box !flex-col">
          <label htmlFor="u" className="text-[12.5px] opacity-70">Kullanıcı adı</label>
          <input
            id="u" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
            className="w-full" value={username} onChange={(e) => setU(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
          />
        </div>
        <div className="search-box !flex-col">
          <label htmlFor="p" className="text-[12.5px] opacity-70">Şifre</label>
          <input
            id="p" type="password" autoComplete="current-password" className="w-full"
            value={password} onChange={(e) => setP(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
          />
        </div>
        <button className="printbtn" type="button" disabled={busy} onClick={login}>Giriş yap</button>
        <div className={"status" + (msg ? " err" : "")} role="alert">{msg}</div>
      </div>
    </div>
  );
}
