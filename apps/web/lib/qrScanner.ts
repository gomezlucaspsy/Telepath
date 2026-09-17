import jsQR from "jsqr";

// Opens the back camera and resolves with the first decoded QR text.
// Caller must have a <video> element it's willing to attach the stream to.
export async function scanQrCode(
  video: HTMLVideoElement,
  options: { signal: AbortSignal }
): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });
  video.srcObject = stream;
  await video.play();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No se pudo crear el contexto de canvas");

  return new Promise<string>((resolve, reject) => {
    let rafId: number;

    const cleanup = () => {
      cancelAnimationFrame(rafId);
      stream.getTracks().forEach((track) => track.stop());
    };

    options.signal.addEventListener("abort", () => {
      cleanup();
      reject(new DOMException("Escaneo cancelado", "AbortError"));
    });

    const tick = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code?.data) {
          cleanup();
          resolve(code.data);
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });
}
