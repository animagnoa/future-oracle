import { prisma } from "./prisma";

const COINGECKO_API =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false";

// Исключаем стейблкоины и неинтересные активы
const EXCLUDED_SYMBOLS = new Set([
  "USDT",
  "USDC",
  "DAI",
  "BUSD",
  "TUSD",
  "USDP",
  "FRAX",
  "FIGR_HELOC",
]);

// Тип для нормализованных данных актива
type AssetData = {
  symbol: string;
  name: string;
  currentPrice: number | null;
  marketCap: number | null;
  volume24h: number | null;
  priceChange24h: number | null;
  priceChange7d: number | null;
  priceChange30d: number | null;
};

export async function fetchCryptoData() {
  const res = await fetch(COINGECKO_API, { cache: "no-store" });
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  const data = await res.json();

  // Фильтруем данные с API
  const filtered = data.filter(
    (coin: any) =>
      !EXCLUDED_SYMBOLS.has(coin.symbol.toUpperCase()) &&
      !coin.name.includes("Heloc"),
  );

  // Нормализуем данные
  const assets: AssetData[] = filtered.map((coin: any) => ({
    symbol: coin.symbol.toUpperCase(),
    name: coin.name,
    currentPrice: coin.current_price ?? null,
    marketCap: coin.market_cap ?? null,
    volume24h: coin.total_volume ?? null,
    priceChange24h: coin.price_change_percentage_24h ?? null,
    priceChange7d: coin.price_change_percentage_7d_in_currency ?? null,
    priceChange30d: coin.price_change_percentage_30d_in_currency ?? null,
  }));

  // Находим активы, которых больше нет в свежем списке
  const newSymbols = assets.map((a) => a.symbol);
  const existingAssets = await prisma.asset.findMany({
    select: { id: true, symbol: true },
  });
  const assetsToDelete = existingAssets.filter(
    (a) => !newSymbols.includes(a.symbol),
  );

  // Удаляем связанные прогнозы и новости, затем сам актив
  for (const asset of assetsToDelete) {
    await prisma.prediction.deleteMany({ where: { assetId: asset.id } });
    await prisma.newsItem.deleteMany({ where: { assetId: asset.id } });
    await prisma.asset.delete({ where: { id: asset.id } });
  }

  // Upsert: обновляем существующие или создаём новые
  for (const a of assets) {
    await prisma.asset.upsert({
      where: { symbol: a.symbol },
      update: a,
      create: a,
    });
  }

  // Обновляем источник данных
  await prisma.dataSource.upsert({
    where: { id: "coingecko" },
    update: { name: "CoinGecko", type: "api", lastFetchedAt: new Date() },
    create: {
      id: "coingecko",
      name: "CoinGecko",
      type: "api",
      lastFetchedAt: new Date(),
    },
  });

  // Логируем обновление в историю
  await prisma.updateLog.create({
    data: {
      type: "crypto",
      items: assets.length,
      details: JSON.stringify({ symbols: assets.map((a) => a.symbol) }),
    },
  });

  return assets.length;
}
