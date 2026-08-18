import { prisma } from "./prisma";

// RSS-ленты
const RSS_FEEDS = [
  {
    source: "CoinDesk",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
];

// Простой парсер XML из строки без внешних библиотек
function parseRSS(xml: string) {
  const items: { title: string; link: string; pubDate: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = item.match(/<title>(.*?)<\/title>/)?.[1] ?? "";
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
    items.push({ title, link, pubDate });
  }
  return items;
}

function decodeHtml(html: string) {
  return html
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchAndStoreFeed(source: string, url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.warn(`Failed to fetch ${source}: ${res.status}`);
    return 0;
  }
  const xml = await res.text();
  const items = parseRSS(xml);
  let count = 0;

  for (const item of items) {
    const title = decodeHtml(item.title);
    const link = decodeHtml(item.link);
    const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();

    // Пытаемся определить, к какой монете относится новость (по символу в заголовке)
    const asset = await guessAssetForNews(title);
    if (!asset) continue; // если не нашли, пропускаем

    await prisma.newsItem.create({
      data: {
        title,
        link,
        pubDate,
        source,
        assetId: asset.id,
      },
    });
    count++;
  }

  // Обновляем DataSource
  await prisma.dataSource.upsert({
    where: { id: `rss-${source.toLowerCase()}` },
    update: { name: `${source} RSS`, type: "rss", lastFetchedAt: new Date() },
    create: {
      id: `rss-${source.toLowerCase()}`,
      name: `${source} RSS`,
      type: "rss",
      lastFetchedAt: new Date(),
    },
  });

  // Логируем обновление
  await prisma.updateLog.create({
    data: {
      type: "news",
      items: count,
      details: JSON.stringify({ source }),
    },
  });

  return count;
}

// Простая функция определения монеты по заголовку (по символам)
async function guessAssetForNews(title: string) {
  const assets = await prisma.asset.findMany();
  const upperTitle = title.toUpperCase();
  for (const asset of assets) {
    if (upperTitle.includes(asset.symbol)) {
      return asset;
    }
  }
  return null;
}

export async function fetchNews() {
  let total = 0;
  for (const feed of RSS_FEEDS) {
    total += await fetchAndStoreFeed(feed.source, feed.url);
  }
  return total;
}
