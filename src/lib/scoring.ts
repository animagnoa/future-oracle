import { prisma } from "./prisma";

// Словари для простого анализа тональности новостных заголовков.
// Это не полноценный NLP, но для прототипа достаточно: считаем вхождения слов.
const POSITIVE_WORDS = [
  "bull",
  "gain",
  "surge",
  "rally",
  "high",
  "positive",
  "adoption",
  "partnership",
  "invest",
  "growth",
  "upgrade",
  "bullish",
  "optimistic",
  "moon",
  "profit",
  "win",
  "support",
  "breakout",
  "recovery",
  "record",
  "approval",
  "institutional",
  "buy",
  "accumulate",
  "integration",
  "launch",
  "success",
];

const NEGATIVE_WORDS = [
  "bear",
  "crash",
  "drop",
  "fall",
  "decline",
  "hack",
  "scam",
  "ban",
  "regulation",
  "fear",
  "uncertainty",
  "loss",
  "low",
  "negative",
  "pessimistic",
  "sell",
  "dump",
  "shutdown",
  "vulnerability",
  "exploit",
  "liquidat",
  "freeze",
  "prohibit",
  "fine",
  "lawsuit",
  "warning",
  "risk",
];

/**
 * Простая функция оценки тональности текста.
 * Возвращает число от -1 (негатив) до 1 (позитив), 0 — нейтрально.
 */
function sentimentScore(text: string): number {
  const lower = text.toLowerCase();
  let positive = 0;
  let negative = 0;

  for (const word of POSITIVE_WORDS) {
    if (lower.includes(word)) positive++;
  }
  for (const word of NEGATIVE_WORDS) {
    if (lower.includes(word)) negative++;
  }

  if (positive + negative === 0) return 0;
  return (positive - negative) / (positive + negative);
}

/**
 * Основная функция расчёта прогнозов для всех активов.
 * Использует данные из таблиц Asset и NewsItem, сохраняет результат в Prediction.
 */
export async function calculatePredictions() {
  // Получаем все активы вместе со связанными новостями
  const assets = await prisma.asset.findMany({
    include: { newsItems: true },
  });

  if (assets.length === 0) {
    throw new Error("Нет данных об активах. Сначала запустите /api/fetch-data");
  }

  // Очищаем старые прогнозы, чтобы не было устаревших записей
  await prisma.prediction.deleteMany({});

  const predictions = [];

  for (const asset of assets) {
    // ===== 1. Ценовые индикаторы =====
    const change24h = asset.priceChange24h ?? 0;
    const change7d = asset.priceChange7d ?? 0;
    const change30d = asset.priceChange30d ?? 0;
    const volume = asset.volume24h ?? 0;

    // Средневзвешенное изменение цены, масштабированное к диапазону около -5..5.
    // Веса подобраны так, чтобы 24ч имели большее значение, чем 7д и 30д.
    const priceScore = (change24h * 0.5 + change7d * 0.3 + change30d * 0.2) / 5;

    // ===== 2. Сентимент новостей =====
    const newsItems = asset.newsItems;
    let newsScore = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    const totalNews = newsItems.length;

    for (const item of newsItems) {
      const s = sentimentScore(item.title);
      if (s > 0.1) positiveCount++;
      else if (s < -0.1) negativeCount++;
      newsScore += s;
    }

    // Средний сентимент (от -1 до 1), умноженный на 5 для приведения к масштабу priceScore
    if (totalNews > 0) {
      newsScore = (newsScore / totalNews) * 5;
    }

    // ===== 3. Итоговый скор =====
    const score = priceScore + newsScore;

    // ===== 4. Направление прогноза =====
    let direction: string;
    if (score > 1.5) direction = "up";
    else if (score < -1.5) direction = "down";
    else direction = "neutral";

    // ===== 5. Уверенность =====
    // Чем дальше score от нуля, тем выше уверенность, максимум 1.
    const confidence = Math.min(1, Math.abs(score) / 8);

    // ===== 6. Оценка риска =====
    // Волатильность: максимальное абсолютное изменение цены за 24ч или 7д
    const volatility = Math.max(Math.abs(change24h), Math.abs(change7d));

    // Определяем направления ценового и новостного сигналов
    const priceDirection =
      priceScore > 0 ? "up" : priceScore < 0 ? "down" : "neutral";
    const newsDirection =
      newsScore > 0.5 ? "up" : newsScore < -0.5 ? "down" : "neutral";

    // Противоречие, если цена и новости указывают в разные стороны
    const conflicting =
      priceDirection !== newsDirection &&
      priceDirection !== "neutral" &&
      newsDirection !== "neutral";

    // Базовая оценка риска по волатильности и конфликтам
    let risk: string;
    if (volatility > 8 || conflicting) {
      risk = "high";
    } else if (volatility > 3) {
      risk = "medium";
    } else {
      risk = "low";
    }

    // Учитываем уверенность: если данных мало и уверенность низкая,
    // риск должен быть выше, даже при низкой волатильности.
    if (confidence < 0.2) {
      risk = "high";
    } else if (confidence < 0.5 && risk === "low") {
      risk = "medium";
    }

    // ===== 7. Формируем reasoning (аргументы) =====
    const reasoning = {
      priceChange24h: change24h,
      priceChange7d: change7d,
      priceChange30d: change30d,
      volume24h: volume,
      newsCount: totalNews,
      positiveNews: positiveCount,
      negativeNews: negativeCount,
      priceScore: +priceScore.toFixed(2),
      newsScore: +newsScore.toFixed(2),
      finalScore: +score.toFixed(2),
      volatility: +volatility.toFixed(2),
      conflictingSignals: conflicting,
    };

    // Сохраняем прогноз в базу
    const prediction = await prisma.prediction.create({
      data: {
        assetId: asset.id,
        direction,
        confidence: +confidence.toFixed(2),
        risk,
        score: +score.toFixed(2),
        reasoning: JSON.stringify(reasoning, null, 2),
      },
    });

    predictions.push(prediction);
  }

  return predictions.length;
}
