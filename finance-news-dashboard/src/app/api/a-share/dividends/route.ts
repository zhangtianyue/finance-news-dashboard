import { NextResponse } from "next/server";
import {
  createEmptyAshareDividendSnapshot,
  fetchAshareDividendSnapshot,
} from "@/lib/a-share-dividends";

export async function GET() {
  try {
    return NextResponse.json(await fetchAshareDividendSnapshot(), {
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
