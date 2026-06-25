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
    console.log('=== НАЧАЛО ЗАПРОСА ===');
    console.log('Метод:', req.method);
    console.log('URL:', req.url);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    
    let q = '';
    let clientKey = '';

    // Получаем query либо из query-string, либо из тела POST-запроса
    if (req.method === 'POST') {
      const body = req.body || {};
      console.log('POST Body получен:', JSON.stringify(body, null, 2));
      q = (body.q || '').trim();
      clientKey = (body.apiKey || '').trim();
    } else {
      console.log('Query params:', JSON.stringify(req.query, null, 2));
      q = (req.query.q || '').trim();
      clientKey = (req.query.apiKey || '').trim();
    }

    // Если клиент передал ключ в кастомном заголовке x-api-key, используем его
    const headerKey = req.headers['x-api-key'];
    if (headerKey) {
      clientKey = headerKey.trim();
    }

    console.log('Параметр q:', q);
    console.log('Ключ API передан клиентом:', clientKey ? 'ДА' : 'НЕТ');

    if (!q) {
      console.log('ОШИБКА: Поисковый запрос пуст');
      return res.status(400).json({ error: 'Поисковый запрос (q) пуст.' });
    }

    // Приоритет ключей: 1. Ключ из переменных окружения Vercel, 2. Ключ, переданный клиентом
    const geminiKey = process.env.GEMINI_API_KEY || clientKey;

    if (!geminiKey) {
      console.log('ОШИБКА: Отсутствует API Key');
      return res.status(400).json({
        error: 'Отсутствует API Key для Gemini. Настройте переменную GEMINI_API_KEY в панели Vercel или передайте ключ на клиенте.'
      });
    }

    console.log('API Key найден: ДА (из Vercel env)');

    const prompt = `You are a language assistant. The user entered a word or phrase: "${q}".
Determine if it is English or Russian.
Return a JSON object (and NOTHING else, no markdown fences like \`\`\`json) with exactly these fields:
- "en": the English version of this word/phrase
- "ru": the Russian translation
- "examples": an array of 3 short example sentences in English with Russian translation, each as {"en":"...","ru":"..."}
Make sure "en" always contains English and "ru" always contains Russian, regardless of what language the user typed.`;

    console.log('Промт отправляется в Gemini:', prompt);

    const modelName = 'gemini-2.0-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
    
    console.log('URL Gemini API:', geminiUrl.replace(geminiKey, '***KEY***'));
    console.log('Отправляем запрос в Gemini...');

    const response = await fetch(geminiUrl, {
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
    });

    console.log('Статус ответа от Gemini:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.log('ОШИБКА от Gemini API:', errText);
      return res.status(response.status).json({
        error: `Google Gemini API вернул ошибку ${response.status}: ${errText}`
      });
    }

    const result = await response.json();
    console.log('Ответ от Gemini получен:', JSON.stringify(result, null, 2));

    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('Извлеченный текст:', rawText);

    // Пытаемся распарсить JSON, возвращенный Gemini
    const cleaned = rawText.replace(/```json\s*/ig, '').replace(/```/g, '').trim();
    console.log('Очищенный текст:', cleaned);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
      console.log('JSON успешно распарсен:', JSON.stringify(parsed, null, 2));
    } catch (parseError) {
      console.log('ОШИБКА при парсинге JSON:', parseError.message);
      throw parseError;
    }

    if (!parsed.en || !parsed.ru) {
      console.log('ОШИБКА: Отсутствуют поля en или ru в ответе');
      return res.status(502).json({
        error: 'AI вернул ответ в некорректном формате (отсутствуют en/ru поля).'
      });
    }

    console.log('=== УСПЕШНЫЙ ОТВЕТ ===');
    return res.status(200).json(parsed);
  } catch (error) {
    console.error('=== ОШИБКА В SERVERLESS-ФУНКЦИИ ===');
    console.error('Тип ошибки:', error.constructor.name);
    console.error('Сообщение ошибки:', error.message);
    console.error('Stack trace:', error.stack);
    return res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера при запросе к Gemini.'
    });
  }
}