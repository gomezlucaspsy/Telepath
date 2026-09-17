# Telepath

Mensajería cifrada extremo a extremo (E2EE), instalable como PWA, tan directa como la telepatía.

## Principios

- **Privado por diseño**: el servidor solo enruta blobs cifrados; nunca ve texto plano.
- **Sin cuentas atadas a un número de teléfono**: vinculación de dispositivos por código QR.
- **Ecosistema abierto**: el protocolo (backend) es independiente del cliente. La PWA es el cliente de referencia, pero puede haber clientes nativos u otros sobre el mismo protocolo.

## Estructura

```
apps/
  web/     Next.js (App Router) — PWA instalable, cliente de referencia
  server/  ASP.NET Core — protocolo/backend (SignalR para tiempo real, REST para emparejamiento)
```

## Desarrollo local

Backend:

```bash
cd apps/server
dotnet dev-certs https --trust   # primera vez, para confiar en el cert HTTPS local
dotnet run
# https://localhost:7218
```

Frontend:

```bash
cd apps/web
cp .env.local.example .env.local
npm install
npm run dev
# http://localhost:3000
```

## Estado actual

Cifrado extremo a extremo real funcionando: Double Ratchet (X25519 + HKDF/HMAC-SHA256 + XChaCha20-Poly1305, primitivas de `libsodium`) con acuerdo de claves tipo X3DH simplificado sobre el emparejamiento por QR. El servidor solo relaya blobs cifrados vía SignalR — nunca ve texto plano ni claves privadas. Emparejamiento con lectura de QR por cámara (`jsqr`) o código manual, sesiones en memoria (sin persistencia todavía).

Correr `npm run crypto:selftest` en `apps/web` valida el ratchet (cifrado/descifrado, mensajes fuera de orden, serialización, y rechazo de manipulación).

Pendiente: persistencia de sesiones/mensajes, autenticación, y clientes nativos.

## Roadmap de transporte (capas, de más a menos disponible)

1. **Internet (WebSocket/SignalR)** — camino principal, ya scaffoldeado.
2. **P2P directo (WebRTC DataChannel)** para archivos grandes — evita que el ancho de banda pesado pase por nuestro servidor. Necesita igual un servidor de señalización chico y un TURN de respaldo para cuando falla la conexión directa.
3. **Bluetooth mesh (offline, corto alcance)** — útil sin internet ni datos móviles (precedente: Bridgefy, FireChat). Requiere Web Bluetooth API, que **iOS Safari no soporta** — o sea, esto solo es viable en el cliente nativo (C#/.NET MAUI), no en la PWA. Otra razón más para no depender solo de la PWA a largo plazo.
4. **SMS opt-in como fallback de emergencia** — mensajes cortos cifrados (~160 caracteres) vía un gateway tipo Twilio cuando no hay ni internet ni Bluetooth cerca. Requiere que el usuario agregue voluntariamente un número de teléfono solo para esto (nunca como requisito de cuenta, para no romper el principio de anonimato).

Descartado por ahora: AM/FM y Morse como transporte — los teléfonos modernos no traen hardware de transmisión de radio de broadcast, así que no es viable en un producto de consumo masivo.
