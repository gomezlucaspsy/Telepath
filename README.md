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

Scaffold inicial: emparejamiento por QR (sesiones en memoria, sin persistencia todavía) y hub de SignalR para relay de mensajes cifrados. Pendiente: cifrado E2EE real (Signal Protocol) en el cliente, persistencia, autenticación, y clientes nativos.
