"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { HubConnection } from "@microsoft/signalr";
import { connectChatHub, sendEncrypted, type IncomingMessage } from "@/lib/signalr";
import { getOrCreateIdentityKeyPair, publicKeyFromBase64, publicKeyToBase64 } from "@/lib/crypto/identity";
import { establishSession } from "@/lib/crypto/session";
import { RatchetSession, type WireMessage } from "@/lib/crypto/doubleRatchet";
import type { KeyPair } from "@/lib/crypto/identity";
import { scanQrCode } from "@/lib/qrScanner";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://localhost:7218";

type Phase = "loading" | "idle" | "waiting-peer" | "scanning" | "chatting" | "error";
type ChatMessage = { fromMe: boolean; text: string };

type SessionStatusResponse = {
  isCompleted: boolean;
  creatorPublicKey: string;
  creatorConnectionId: string;
  peerPublicKey: string | null;
  peerConnectionId: string | null;
};

export default function Home() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const identityRef = useRef<KeyPair | null>(null);
  const connectionRef = useRef<HubConnection | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const ratchetRef = useRef<RatchetSession | null>(null);
  const peerConnectionIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  const handleIncoming = useCallback((msg: IncomingMessage) => {
    if (!ratchetRef.current || msg.senderConnectionId !== peerConnectionIdRef.current) return;
    const wireMsg = JSON.parse(msg.payload) as WireMessage;
    ratchetRef.current
      .decrypt(wireMsg)
      .then((text) => setMessages((prev) => [...prev, { fromMe: false, text }]))
      .catch(() => setErrorText("No se pudo descifrar un mensaje entrante."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const identity = await getOrCreateIdentityKeyPair();
        identityRef.current = identity;
        const connection = await connectChatHub(handleIncoming);
        if (cancelled) return;
        connectionRef.current = connection;
        connectionIdRef.current = connection.connectionId;
        setPhase("idle");
      } catch {
        if (!cancelled) {
          setErrorText("No se pudo conectar con el servidor. ¿Está corriendo el backend?");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      connectionRef.current?.stop();
    };
  }, [handleIncoming]);

  const startPairing = useCallback(async () => {
    if (!identityRef.current || !connectionIdRef.current) return;
    try {
      const res = await fetch(`${API_URL}/api/pairing/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: publicKeyToBase64(identityRef.current.publicKey),
          connectionId: connectionIdRef.current,
        }),
      });
      if (!res.ok) throw new Error("No se pudo crear la sesión");
      const data: { code: string; expiresAt: string } = await res.json();
      setPairingCode(data.code);
      setQrDataUrl(await QRCode.toDataURL(data.code));
      setPhase("waiting-peer");

      pollRef.current = setInterval(async () => {
        const statusRes = await fetch(`${API_URL}/api/pairing/session/${data.code}`);
        if (!statusRes.ok) return;
        const status: SessionStatusResponse = await statusRes.json();
        if (status.isCompleted && status.peerPublicKey && status.peerConnectionId) {
          if (pollRef.current) clearInterval(pollRef.current);
          peerConnectionIdRef.current = status.peerConnectionId;
          const session = await establishSession(
            identityRef.current!,
            publicKeyFromBase64(status.peerPublicKey)
          );
          ratchetRef.current = session;
          setPhase("chatting");
        }
      }, 2000);
    } catch {
      setErrorText("No se pudo conectar con el servidor. ¿Está corriendo el backend?");
      setPhase("error");
    }
  }, []);

  const joinWithCode = useCallback(async (codeArg?: string) => {
    const code = codeArg ?? joinCodeInput;
    if (!identityRef.current || !connectionIdRef.current || !code) return;
    try {
      const statusRes = await fetch(`${API_URL}/api/pairing/session/${code}`);
      if (!statusRes.ok) throw new Error("Código inválido o expirado");
      const status: SessionStatusResponse = await statusRes.json();

      const completeRes = await fetch(
        `${API_URL}/api/pairing/session/${code}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicKey: publicKeyToBase64(identityRef.current.publicKey),
            connectionId: connectionIdRef.current,
          }),
        }
      );
      if (!completeRes.ok) throw new Error("No se pudo completar el emparejamiento");

      peerConnectionIdRef.current = status.creatorConnectionId;
      const session = await establishSession(
        identityRef.current,
        publicKeyFromBase64(status.creatorPublicKey)
      );
      ratchetRef.current = session;
      setPhase("chatting");
    } catch {
      setErrorText("No se pudo unir con ese código. ¿Es correcto y sigue vigente?");
      setPhase("idle");
    }
  }, [joinCodeInput]);

  const startScanning = useCallback(() => {
    setErrorText(null);
    setPhase("scanning");
  }, []);

  const cancelScanning = useCallback(() => {
    scanAbortRef.current?.abort();
    setPhase("idle");
  }, []);

  useEffect(() => {
    if (phase !== "scanning" || !videoRef.current) return;
    const controller = new AbortController();
    scanAbortRef.current = controller;
    scanQrCode(videoRef.current, { signal: controller.signal })
      .then((code) => joinWithCode(code))
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setErrorText("No se pudo acceder a la cámara para escanear el QR.");
        setPhase("idle");
      });
    return () => controller.abort();
  }, [phase, joinWithCode]);

  const sendMessage = useCallback(async () => {
    if (!draft.trim() || !ratchetRef.current || !connectionRef.current || !peerConnectionIdRef.current) {
      return;
    }
    const text = draft.trim();
    setDraft("");
    const wireMsg = await ratchetRef.current.encrypt(text);
    await sendEncrypted(connectionRef.current, peerConnectionIdRef.current, JSON.stringify(wireMsg));
    setMessages((prev) => [...prev, { fromMe: true, text }]);
  }, [draft]);

  if (phase === "chatting") {
    return (
      <main className="flex flex-1 flex-col px-4 py-6 max-w-lg mx-auto w-full">
        <h1 className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-2xl font-bold text-transparent mb-1">
          Telepath
        </h1>
        <p className="text-xs text-neutral-500 mb-4">
          Sesión cifrada extremo a extremo establecida.
        </p>
        <div className="flex-1 flex flex-col gap-2 overflow-y-auto mb-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                m.fromMe
                  ? "self-end bg-gradient-to-r from-blue-500 to-pink-500 text-white"
                  : "self-start bg-neutral-800 text-neutral-100"
              }`}
            >
              {m.text}
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="flex gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Escribí un mensaje..."
            className="flex-1 rounded-full border border-neutral-700 bg-transparent px-4 py-2 text-sm outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-gradient-to-r from-blue-500 to-pink-500 px-5 py-2 text-sm font-medium text-white"
          >
            Enviar
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-5xl font-bold text-transparent">
          Telepath
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Mensajería cifrada extremo a extremo. Tan directa como la telepatía.
        </p>
      </div>

      {phase === "waiting-peer" && qrDataUrl ? (
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="Código QR de vinculación"
            className="size-56 rounded-lg border border-neutral-800"
          />
          <p className="font-mono text-lg tracking-widest">{pairingCode}</p>
          <p className="text-xs text-neutral-500">
            Escaneá este código desde otro dispositivo para vincularlo.
          </p>
        </div>
      ) : phase === "scanning" ? (
        <div className="flex flex-col items-center gap-3">
          <video
            ref={videoRef}
            playsInline
            muted
            className="size-56 rounded-lg border border-neutral-800 object-cover"
          />
          <p className="text-xs text-neutral-500">Apuntá la cámara al código QR.</p>
          <button
            onClick={cancelScanning}
            className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6 w-full max-w-xs">
          <button
            onClick={startPairing}
            disabled={phase !== "idle"}
            className="w-full rounded-full bg-gradient-to-r from-blue-500 to-pink-500 px-8 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {phase === "loading" ? "Conectando..." : "Vincular dispositivo"}
          </button>

          <div className="flex items-center gap-2 w-full text-neutral-600 text-xs">
            <div className="h-px flex-1 bg-neutral-800" />
            o unite con un código
            <div className="h-px flex-1 bg-neutral-800" />
          </div>

          <button
            onClick={startScanning}
            disabled={phase !== "idle"}
            className="w-full rounded-full border border-neutral-700 px-8 py-3 font-medium disabled:opacity-50"
          >
            Escanear QR
          </button>

          <div className="flex w-full gap-2">
            <input
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value)}
              placeholder="o escribí el código: 123456"
              className="flex-1 rounded-full border border-neutral-700 bg-transparent px-4 py-2 text-sm text-center font-mono tracking-widest outline-none"
            />
            <button
              onClick={() => joinWithCode()}
              disabled={phase !== "idle"}
              className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Unirme
            </button>
          </div>
        </div>
      )}

      {errorText && <p className="text-sm text-red-500">{errorText}</p>}
    </main>
  );
}
