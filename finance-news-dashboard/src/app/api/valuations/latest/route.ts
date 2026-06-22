import { NextResponse } from "next/server";
import { createGlobalValuationSnapshot } from "@/lib/global-valuations";

export async function GET() {
  return NextResponse.json(createGlobalValuationSnapshot(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
