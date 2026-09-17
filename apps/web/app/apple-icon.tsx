import { ImageResponse } from "next/og";
import { telepathIconElement } from "@/lib/telepath-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(telepathIconElement(size.width), { ...size });
}
