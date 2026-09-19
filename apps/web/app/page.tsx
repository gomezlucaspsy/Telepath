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
import {
  appendMessage,
  createConversation,
  deleteConversation,
  listConversations,
  renameConversation,
  type StoredConversation,
} from "@/lib/conversations";
import { claimUsername, getOwnUsername, lookupUsername } from "@/lib/username";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://localhost:7218";

type Phase = "loading" | "list" | "new" | "waiting-peer" | "scanning" | "chatting" | "share" | "error";
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
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [activeLabel, setActiveLabel] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [ownUsername, setOwnUsername] = useState<string | null>(null);
  const [addByUsernameInput, setAddByUsernameInput] = useState("");
  const [appShareQrDataUrl, setAppShareQrDataUrl] = useState<string | null>(null);

  const identityRef = useRef<KeyPair | null>(null);
  const connectionRef = useRef<HubConnection | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const ratchetRef = useRef<RatchetSession | null>(null);
  const peerConnectionIdRef = useRef<string | null>(null);
  const activePeerKeyRef = useRef<string | null>(null);
  const activePeerUsernameRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  const refreshConversations = useCallback(() => {
    setConversations(listConversations());
  }, []);

  const handleIncoming = useCallback((msg: IncomingMessage) => {
    if (!ratchetRef.current || msg.senderConnectionId !== peerConnectionIdRef.current) return;
    const wireMsg = JSON.parse(msg.payload) as WireMessage;
    ratchetRef.current
      .decrypt(wireMsg)
      .then((text) => {
        setMessages((prev) => [...prev, { fromMe: false, text }]);
        const peerKey = activePeerKeyRef.current;
        if (peerKey && ratchetRef.current) {
          appendMessage(peerKey, { fromMe: false, text }, ratchetRef.current.toJSON());
          refreshConversations();
        }
      })
      .catch(() => setErrorText("No se pudo descifrar un mensaje entrante."));
  }, [refreshConversations]);

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

        const existingUsername = getOwnUsername();
        if (existingUsername && connection.connectionId) {
          setOwnUsername(existingUsername);
          claimUsername(existingUsername, publicKeyToBase64(identity.publicKey), connection.connectionId);
        }

        refreshConversations();
        setPhase("list");
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
  }, [handleIncoming, refreshConversations]);

  const openConversation = useCallback((conv: StoredConversation) => {
    ratchetRef.current = RatchetSession.fromJSON(conv.ratchetSessionJson);
    peerConnectionIdRef.current = conv.peerConnectionId;
    activePeerKeyRef.current = conv.peerPublicKey;
    activePeerUsernameRef.current = conv.peerUsername;
    setActiveLabel(conv.label);
    setMessages(conv.messages.map((m) => ({ fromMe: m.fromMe, text: m.text })));
    setErrorText(null);
    setPhase("chatting");
  }, []);

  const backToList = useCallback(() => {
    ratchetRef.current = null;
    peerConnectionIdRef.current = null;
    activePeerKeyRef.current = null;
    activePeerUsernameRef.current = null;
    setMessages([]);
    refreshConversations();
    setPhase("list");
  }, [refreshConversations]);

  const handleDelete = useCallback((peerPublicKey: string, label: string) => {
    if (!window.confirm(`¿Borrar la conversación con "${label}"? Esto borra los mensajes y las claves de sesión de este dispositivo, sin vuelta atrás.`)) {
      return;
    }
    deleteConversation(peerPublicKey);
    if (activePeerKeyRef.current === peerPublicKey) {
      backToList();
    } else {
      refreshConversations();
    }
  }, [backToList, refreshConversations]);

  const handleRename = useCallback((peerPublicKey: string, currentLabel: string) => {
    const name = window.prompt("Nombre del contacto:", currentLabel);
    if (!name || !name.trim()) return;
    renameConversation(peerPublicKey, name.trim());
    if (activePeerKeyRef.current === peerPublicKey) {
      setActiveLabel(name.trim());
    }
    refreshConversations();
  }, [refreshConversations]);

  const openShareApp = useCallback(async () => {
    setErrorText(null);
    setAppShareQrDataUrl(await QRCode.toDataURL(window.location.origin));
    setPhase("share");
  }, []);

  const shareAppLink = useCallback(async () => {
    const url = window.location.origin;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Telepath", text: "Chateá conmigo por Telepath, cifrado extremo a extremo:", url });
        return;
      } catch {
        // user cancelled the native sheet — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setErrorText(null);
    } catch {
      setErrorText("No se pudo copiar el link automáticamente, copialo manual.");
    }
  }, []);

  const startNewConversation = useCallback(() => {
    setErrorText(null);
    setJoinCodeInput("");
    setAddByUsernameInput("");
    setQrDataUrl(null);
    setPairingCode(null);
    setPhase("new");
  }, []);

  const openEstablishedConversation = useCallback((
    peerPublicKey: string,
    peerConnectionId: string,
    session: RatchetSession,
    peerUsername?: string | null
  ) => {
    ratchetRef.current = session;
    peerConnectionIdRef.current = peerConnectionId;
    const conv = createConversation({
      peerPublicKey,
      peerConnectionId,
      peerUsername,
      ratchetSessionJson: session.toJSON(),
    });
    activePeerKeyRef.current = conv.peerPublicKey;
    activePeerUsernameRef.current = conv.peerUsername;
    setActiveLabel(conv.label);
    setMessages(conv.messages.map((m) => ({ fromMe: m.fromMe, text: m.text })));
    refreshConversations();
    setPhase("chatting");
  }, [refreshConversations]);

  const handleSetOwnUsername = useCallback(async () => {
    if (!identityRef.current || !connectionIdRef.current) return;
    const chosen = window.prompt("Elegí tu username (3-20 caracteres, letras/números/_):", ownUsername ?? "");
    if (!chosen || !chosen.trim()) return;
    const result = await claimUsername(
      chosen.trim(),
      publicKeyToBase64(identityRef.current.publicKey),
      connectionIdRef.current
    );
    if (!result.ok) {
      setErrorText(result.error);
      return;
    }
    setOwnUsername(chosen.trim().toLowerCase());
    setErrorText(null);
  }, [ownUsername]);

  const addByUsername = useCallback(async (usernameArg?: string) => {
    const username = (usernameArg ?? addByUsernameInput).trim();
    if (!identityRef.current || !username) return;
    setErrorText(null);
    const found = await lookupUsername(username);
    if (!found) {
      setErrorText("No encontramos ese username, o esa persona no está conectada ahora.");
      return;
    }
    const session = await establishSession(identityRef.current, publicKeyFromBase64(found.publicKey));
    openEstablishedConversation(found.publicKey, found.connectionId, session, username.toLowerCase());
  }, [addByUsernameInput, openEstablishedConversation]);

  const shareMyUsername = useCallback(async () => {
    if (!ownUsername) return;
    const url = `${window.location.origin}/?u=${encodeURIComponent(ownUsername)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Telepath", text: `Agregame en Telepath: @${ownUsername}`, url });
        return;
      } catch {
        // user cancelled the native sheet — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setErrorText(null);
    } catch {
      setErrorText("No se pudo copiar el link automáticamente, copialo manual.");
    }
  }, [ownUsername]);

  // Deep link: opening ?u=<username> auto-adds that contact, so a shared
  // link is a one-tap add instead of retyping a username by hand.
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (phase !== "list" || deepLinkHandledRef.current) return;
    const wantedUsername = new URLSearchParams(window.location.search).get("u");
    if (!wantedUsername) return;
    deepLinkHandledRef.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    setErrorText(null);
    setAddByUsernameInput(wantedUsername);
    setPhase("new");
    addByUsername(wantedUsername);
  }, [phase, addByUsername]);

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
          const session = await establishSession(
            identityRef.current!,
            publicKeyFromBase64(status.peerPublicKey)
          );
          openEstablishedConversation(status.peerPublicKey, status.peerConnectionId, session);
        }
      }, 2000);
    } catch {
      setErrorText("No se pudo conectar con el servidor. ¿Está corriendo el backend?");
      setPhase("error");
    }
  }, [openEstablishedConversation]);

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

      const session = await establishSession(
        identityRef.current,
        publicKeyFromBase64(status.creatorPublicKey)
      );
      openEstablishedConversation(status.creatorPublicKey, status.creatorConnectionId, session);
    } catch {
      setErrorText("No se pudo unir con ese código. ¿Es correcto y sigue vigente?");
      setPhase("new");
    }
  }, [joinCodeInput, openEstablishedConversation]);

  const startScanning = useCallback(() => {
    setErrorText(null);
    setPhase("scanning");
  }, []);

  const cancelScanning = useCallback(() => {
    scanAbortRef.current?.abort();
    setPhase("new");
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
        setPhase("new");
      });
    return () => controller.abort();
  }, [phase, joinWithCode]);

  const sendMessage = useCallback(async () => {
    if (!draft.trim() || !ratchetRef.current || !connectionRef.current) return;

    // A contact added by username is never really "lost": look up their
    // current connectionId fresh instead of trusting the cached one, which
    // goes stale the moment they reload or reconnect.
    if (activePeerUsernameRef.current) {
      const fresh = await lookupUsername(activePeerUsernameRef.current);
      if (!fresh) {
        setErrorText("Tu contacto no está conectado ahora mismo.");
        return;
      }
      peerConnectionIdRef.current = fresh.connectionId;
    }
    if (!peerConnectionIdRef.current) return;

    const text = draft.trim();
    setDraft("");
    const wireMsg = await ratchetRef.current.encrypt(text);
    await sendEncrypted(connectionRef.current, peerConnectionIdRef.current, JSON.stringify(wireMsg));
    setMessages((prev) => [...prev, { fromMe: true, text }]);
    const peerKey = activePeerKeyRef.current;
    if (peerKey) {
      appendMessage(peerKey, { fromMe: true, text }, ratchetRef.current.toJSON());
    }
  }, [draft]);

  if (phase === "chatting") {
    return (
      <main className="flex flex-1 flex-col px-4 py-6 max-w-lg mx-auto w-full">
        <div className="flex items-center justify-between mb-1">
          <button onClick={backToList} className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Chats
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => activePeerKeyRef.current && handleRename(activePeerKeyRef.current, activeLabel)}
              aria-label="Agendar como contacto"
              title="Agendar como contacto"
              className="text-sm text-neutral-400 hover:text-neutral-200"
            >
              👤
            </button>
            <button
              onClick={() => activePeerKeyRef.current && handleDelete(activePeerKeyRef.current, activeLabel)}
              aria-label="Borrar conversación"
              title="Borrar conversación"
              className="text-sm text-red-500 hover:text-red-400"
            >
              🗑
            </button>
          </div>
        </div>
        <h1 className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-2xl font-bold text-transparent mb-1">
          {activeLabel || "Telepath"}
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
        {errorText && <p className="text-sm text-red-500 mt-2">{errorText}</p>}
      </main>
    );
  }

  if (phase === "share") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <div>
          <h1 className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-3xl font-bold text-transparent">
            Compartir Telepath
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            Que la instale quien escanee este QR o abra el link. Sin fricción.
          </p>
        </div>

        {appShareQrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={appShareQrDataUrl}
            alt="Código QR para instalar Telepath"
            className="size-56 rounded-lg border border-neutral-800"
          />
        )}

        <p className="font-mono text-xs text-neutral-500 break-all max-w-xs">
          {typeof window !== "undefined" ? window.location.origin : ""}
        </p>

        <div className="flex flex-col items-center gap-3 w-full max-w-xs">
          <button
            onClick={shareAppLink}
            className="w-full rounded-full bg-gradient-to-r from-blue-500 to-pink-500 px-8 py-3 font-medium text-white transition-opacity hover:opacity-90"
          >
            Compartir link
          </button>
          <button onClick={backToList} className="text-xs text-neutral-500 hover:text-neutral-300">
            ← Volver a chats
          </button>
        </div>

        {errorText && <p className="text-sm text-red-500">{errorText}</p>}
      </main>
    );
  }

  if (phase === "list") {
    return (
      <main className="flex flex-1 flex-col px-4 py-6 max-w-lg mx-auto w-full">
        <div className="flex items-center justify-between mb-1">
          <h1 className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-3xl font-bold text-transparent">
            Telepath
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={openShareApp}
              aria-label="Compartir Telepath"
              title="Compartir Telepath"
              className="flex size-9 items-center justify-center rounded-full border border-neutral-700 text-base leading-none"
            >
              🔗
            </button>
            <button
              onClick={startNewConversation}
              aria-label="Vincular nuevo dispositivo"
              title="Vincular nuevo dispositivo"
              className="flex size-9 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-pink-500 text-lg font-medium text-white leading-none"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={handleSetOwnUsername}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            👤 {ownUsername ? `@${ownUsername}` : "Elegí tu username para que te agreguen"}
          </button>
          {ownUsername && (
            <button
              onClick={shareMyUsername}
              aria-label="Compartir mi link"
              title="Compartir mi link"
              className="text-xs text-neutral-400 hover:text-neutral-200"
            >
              🔗 Compartir mi link
            </button>
          )}
        </div>

        {conversations.length === 0 ? (
          <p className="text-sm text-neutral-500 text-center mt-12">
            Todavía no vinculaste ningún dispositivo. Tocá el + para empezar.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {conversations.map((conv) => {
              const last = conv.messages[conv.messages.length - 1];
              return (
                <div
                  key={conv.peerPublicKey}
                  className="flex items-center gap-2 rounded-2xl border border-neutral-800 px-4 py-3"
                >
                  <button
                    onClick={() => openConversation(conv)}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-sm font-medium truncate">{conv.label}</p>
                    <p className="text-xs text-neutral-500 truncate">
                      {last ? (last.fromMe ? "Vos: " : "") + last.text : "Sin mensajes todavía"}
                    </p>
                  </button>
                  <button
                    onClick={() => handleRename(conv.peerPublicKey, conv.label)}
                    aria-label={`Agendar contacto ${conv.label}`}
                    title="Agendar como contacto"
                    className="text-neutral-600 hover:text-neutral-300 text-sm px-1"
                  >
                    👤
                  </button>
                  <button
                    onClick={() => handleDelete(conv.peerPublicKey, conv.label)}
                    aria-label={`Borrar conversación con ${conv.label}`}
                    title="Borrar conversación"
                    className="text-neutral-600 hover:text-red-500 text-sm px-1"
                  >
                    🗑
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {errorText && <p className="text-sm text-red-500 mt-4 text-center">{errorText}</p>}
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
            disabled={phase !== "new"}
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
            disabled={phase !== "new"}
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
              disabled={phase !== "new"}
              className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Unirme
            </button>
          </div>

          <div className="flex items-center gap-2 w-full text-neutral-600 text-xs">
            <div className="h-px flex-1 bg-neutral-800" />
            o agregá por username
            <div className="h-px flex-1 bg-neutral-800" />
          </div>

          <div className="flex w-full gap-2">
            <input
              value={addByUsernameInput}
              onChange={(e) => setAddByUsernameInput(e.target.value)}
              placeholder="@username"
              className="flex-1 rounded-full border border-neutral-700 bg-transparent px-4 py-2 text-sm outline-none"
            />
            <button
              onClick={() => addByUsername()}
              disabled={phase !== "new"}
              className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Agregar
            </button>
          </div>

          {phase !== "loading" && (
            <button onClick={backToList} className="text-xs text-neutral-500 hover:text-neutral-300">
              ← Volver a chats
            </button>
          )}
        </div>
      )}

      {errorText && <p className="text-sm text-red-500">{errorText}</p>}
    </main>
  );
}
