import { ImageResponse } from "next/og";
import { telepathIconElement } from "@/lib/telepath-icon";

const size = { width: 192, height: 192 };

export async function GET() {
  return new ImageResponse(telepathIconElement(size.width), { ...size });
}
