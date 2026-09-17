"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://localhost:7218";

type PairingSession = {
  code: string;
  expiresAt: string;
};

export default function Home() {
  const [session, setSession] = useState<PairingSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPairing = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`${API_URL}/api/pairing/session`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("No se pudo crear la sesión");
      const data: PairingSession = await res.json();
      setSession(data);
      setQrDataUrl(await QRCode.toDataURL(data.code));
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    pollRef.current = setInterval(async () => {
      const res = await fetch(
        `${API_URL}/api/pairing/session/${session.code}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.isCompleted && pollRef.current) {
          clearInterval(pollRef.current);
        }
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [session]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-5xl font-bold text-transparent">
          Telepath
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Mensajería cifrada extremo a extremo. Tan directa como la
          telepatía.
        </p>
      </div>

      {qrDataUrl ? (
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="Código QR de vinculación"
            className="size-56 rounded-lg border border-neutral-800"
          />
          <p className="font-mono text-lg tracking-widest">
            {session?.code}
          </p>
          <p className="text-xs text-neutral-500">
            Escaneá este código desde otro dispositivo para vincularlo.
          </p>
        </div>
      ) : (
        <button
          onClick={startPairing}
          disabled={status === "loading"}
          className="rounded-full bg-gradient-to-r from-blue-500 to-pink-500 px-8 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === "loading" ? "Generando..." : "Vincular dispositivo"}
        </button>
      )}

      {status === "error" && (
        <p className="text-sm text-red-500">
          No se pudo conectar con el servidor. ¿Está corriendo el backend?
        </p>
      )}
    </main>
  );
}
