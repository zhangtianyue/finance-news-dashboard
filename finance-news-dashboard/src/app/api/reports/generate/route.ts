import { NextRequest, NextResponse } from "next/server";
import { generateMorningReport } from "@/lib/news-report";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const auth = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");

  return auth === `Bearer ${secret}` || querySecret === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await generateMorningReport();
  return NextResponse.json(report, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
