import { NextRequest, NextResponse } from "next/server";
import { normalizeGoogleFormUrl, parseGoogleFormHtml } from "@/lib/googleFormParser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParseRequest = {
  url?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ParseRequest;
    const sourceUrl = normalizeGoogleFormUrl(body.url ?? "");

    const response = await fetch(sourceUrl, {
      method: "GET",
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: `Không tải được Google Form. HTTP status: ${response.status}`,
        },
        { status: 400 },
      );
    }

    const html = await response.text();
    const parsed = parseGoogleFormHtml(html, sourceUrl);

    return NextResponse.json({
      ok: true,
      data: parsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Có lỗi không xác định.";
    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 400 },
    );
  }
}
