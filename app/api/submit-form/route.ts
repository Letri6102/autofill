import { NextRequest, NextResponse } from "next/server";
import { normalizeGoogleFormUrl, toGoogleFormResponseUrl } from "@/lib/googleFormParser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PayloadValue = string | string[];

type SubmitRequest = {
  sourceUrl?: string;
  payload?: Record<string, PayloadValue>;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidPayload(payload: unknown): payload is Record<string, PayloadValue> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;

  return Object.entries(payload).every(
    ([key, value]) => key.trim() && (typeof value === "string" || isStringArray(value)),
  );
}

function toUrlSearchParams(payload: Record<string, PayloadValue>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else {
      params.append(key, value);
    }
  }

  return params;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SubmitRequest;
    const sourceUrl = normalizeGoogleFormUrl(body.sourceUrl ?? "");

    if (!isValidPayload(body.payload)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Payload không hợp lệ.",
        },
        { status: 400 },
      );
    }

    const formResponseUrl = toGoogleFormResponseUrl(sourceUrl);
    const params = toUrlSearchParams(body.payload);

    const response = await fetch(formResponseUrl, {
      method: "POST",
      cache: "no-store",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Origin: "https://docs.google.com",
        Referer: sourceUrl,
      },
      body: params.toString(),
    });

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
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
