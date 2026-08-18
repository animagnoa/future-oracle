import { NextResponse } from "next/server";
import { calculatePredictions } from "@/lib/scoring";

export async function GET() {
  try {
    const count = await calculatePredictions();
    return NextResponse.json({ ok: true, predictionsCreated: count });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
