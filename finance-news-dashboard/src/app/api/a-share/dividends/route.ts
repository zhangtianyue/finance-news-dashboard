import { NextRequest, NextResponse } from "next/server";
import {
  createEmptyAshareDividendSnapshot,
  fetchAshareDividendSnapshot,
} from "@/lib/a-share-dividends";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const force = request.nextUrl.searchParams.get("refresh") === "1";
    return NextResponse.json(await fetchAshareDividendSnapshot({ force }), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "A 股股息率数据更新失败";
    return NextResponse.json(
      {
        ...createEmptyAshareDividendSnapshot(`A 股股息率更新失败：${message}`),
        status: "error",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
