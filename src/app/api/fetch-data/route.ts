import { NextResponse } from "next/server";
import { fetchCryptoData } from "@/lib/coingecko";
import { fetchNews } from "@/lib/news";

export async function GET() {
  try {
    const assets = await fetchCryptoData();
    const news = await fetchNews();
    return NextResponse.json({ ok: true, assets, news });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
