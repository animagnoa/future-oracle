import { prisma } from "@/lib/prisma";
import { fetchCryptoData } from "@/lib/coingecko";
import { fetchNews } from "@/lib/news";
import { calculatePredictions } from "@/lib/scoring";

export const dynamic = "force-dynamic";

async function ensureData() {
  const assetCount = await prisma.asset.count();
  const predictionCount = await prisma.prediction.count();
  const lastFetch = await prisma.dataSource.findFirst({
    where: { id: "coingecko" },
  });

  // Обновляем данные, если активов нет или прошло больше 10 минут
  const shouldFetch =
    assetCount === 0 ||
    !lastFetch?.lastFetchedAt ||
    Date.now() - lastFetch.lastFetchedAt.getTime() > 1 * 60 * 1000;

  if (shouldFetch) {
    await fetchCryptoData();
    await fetchNews();
  }

  // Пересоздаём прогнозы, если их нет или данные обновились
  if (predictionCount === 0 || shouldFetch) {
    await calculatePredictions();
  }
}

export default async function Home() {
  await ensureData();

  const assets = await prisma.asset.findMany({
    include: {
      predictions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { marketCap: "desc" },
  });

  if (assets.length === 0) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Нет данных</h1>
          <p className="text-slate-300">
            Не удалось загрузить данные. Попробуйте позже.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">
          Future Oracle: Crypto Forecasts
        </h1>
        <p className="text-slate-400 mb-8">
          Прогнозы на основе цен CoinGecko и новостей RSS (CoinDesk,
          Cointelegraph)
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset) => {
            const prediction = asset.predictions[0];
            if (!prediction) return null;

            const reasoning = JSON.parse(prediction.reasoning);

            return (
              <div
                key={asset.id}
                className="bg-slate-900 rounded-2xl border border-slate-800 p-5 shadow hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-xl font-semibold">
                      {asset.name}{" "}
                      <span className="text-slate-400 text-sm">
                        ({asset.symbol})
                      </span>
                    </h2>
                    <p className="text-slate-400 text-sm">
                      ${asset.currentPrice?.toLocaleString() ?? "—"}
                    </p>
                  </div>
                  <span
                    className={`text-2xl font-bold ${
                      prediction.direction === "up"
                        ? "text-emerald-400"
                        : prediction.direction === "down"
                          ? "text-red-400"
                          : "text-slate-400"
                    }`}
                  >
                    {prediction.direction === "up"
                      ? "↗"
                      : prediction.direction === "down"
                        ? "↘"
                        : "→"}
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm text-slate-300">
                    {prediction.direction === "up"
                      ? "Прогноз: рост"
                      : prediction.direction === "down"
                        ? "Прогноз: падение"
                        : "Нейтрально"}
                  </span>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded">
                    Уверенность: {Math.round(prediction.confidence * 100)}%
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      prediction.risk === "high"
                        ? "bg-red-500/20 text-red-300"
                        : prediction.risk === "medium"
                          ? "bg-yellow-500/20 text-yellow-300"
                          : "bg-emerald-500/20 text-emerald-300"
                    }`}
                  >
                    Риск: {prediction.risk}
                  </span>
                </div>

                <div className="text-xs text-slate-400 space-y-1">
                  <p>Score: {prediction.score}</p>
                  <p>
                    Изменение за 24ч: {reasoning.priceChange24h?.toFixed(2)}%
                  </p>
                  <p>Изменение за 7д: {reasoning.priceChange7d?.toFixed(2)}%</p>
                  <p>Новостей в анализе: {reasoning.newsCount}</p>
                  {reasoning.newsCount > 0 && (
                    <p>
                      Позитивных: {reasoning.positiveNews}, негативных:{" "}
                      {reasoning.negativeNews}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
