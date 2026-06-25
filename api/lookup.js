module.exports = async function handler(req, res) {
  // Обработка Preflight CORS-запросов
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-api-key, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let q = '';
    let clientKey = '';

    // Получаем query либо из query-string, либо из тела POST-запроса
    if (req.method === 'POST') {
      const body = req.body || {};
      q = (body.q || '').trim();
      clientKey = (body.apiKey || '').trim();
    } else {
      q = (req.query.q || '').trim();
      clientKey = (req.query.apiKey || '').trim();
    }

    // Если клиент передал ключ в кастомном заголовке x-api-key, используем его
    const headerKey = req.headers['x-api-key'];
    if (headerKey) {
      clientKey = headerKey.trim();
    }

    if (!q) {
      return res.status(400).json({ error: 'Поисковый запрос (q) пуст.' });
    }

    // Приоритет ключей: 1. Ключ из переменных окружения Vercel, 2. Ключ, переданный клиентом
    const geminiKey = process.env.GEMINI_API_KEY || clientKey;

    if (!geminiKey) {
      return res.status(400).json({
        error: 'Отсутствует API Key для Gemini. Настройте переменную GEMINI_API_KEY в панели Vercel или передайте ключ на клиенте.'
      });
    }

    const prompt = `You are a language assistant. The user entered a word or phrase: "${q}".
Determine if it is English or Russian.
Return a JSON object (and NOTHING else, no markdown fences like \`\`\`json) with exactly these fields:
- "en": the English version of this word/phrase
- "ru": the Russian translation
- "examples": an array of 3 short example sentences in English with Russian translation, each as {"en":"...","ru":"..."}
Make sure "en" always contains English and "ru" always contains Russian, regardless of what language the user typed.`;

    const modelName = 'gemini-1.5-flash-latest';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Google Gemini API вернул ошибку ${response.status}: ${errText}`
      });
    }

    const result = await response.json();
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Пытаемся распарсить JSON, возвращенный Gemini
    const cleaned = rawText.replace(/```json\s*/ig, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.en || !parsed.ru) {
      return res.status(502).json({
        error: 'AI вернул ответ в некорректном формате (отсутствуют en/ru поля).'
      });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error('Ошибка в serverless-функции lookup:', error);
    return res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера при запросе к Gemini.'
    });
  }
}
