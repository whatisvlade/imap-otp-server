import express from 'express';
import Imap from 'imap-simple';
import cors from 'cors';
import { load } from 'cheerio';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/mail', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  console.log(`Попытка подключения к IMAP для: ${email}`);

  const config = {
    imap: {
      user: email,
      password,
      host: 'imap.firstmail.ltd',
      port: 993,
      tls: true,
      tlsOptions: {
        rejectUnauthorized: false,
        servername: 'imap.firstmail.ltd'
      },
      authTimeout: 10000,
      connTimeout: 10000
    }
  };

  let connection = null;

  try {
    console.log('Подключаемся к IMAP серверу...');
    connection = await Imap.connect(config);
    console.log('IMAP подключение установлено');

    await connection.openBox('INBOX');
    console.log('INBOX открыт');

    // Ищем письма от noreply.app@blsinternational.com с темой OTP Confirmation
    const criteria = [
      ['FROM', 'noreply.app@blsinternational.com'],
      ['SUBJECT', 'OTP Confirmation']
    ];

    // Загружаем полное содержимое письма включая HTML
    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', 'HTML', ''], // Заголовки, текст, HTML и полное тело
      struct: true,
      markSeen: false
    };

    console.log('Ищем письма с OTP...');
    const messages = await connection.search(criteria, fetchOptions);

    if (!messages.length) {
      console.log('Письма с OTP не найдены');
      await connection.end();
      return res.json({ message: 'No OTP Confirmation emails found' });
    }

    console.log(`Найдено писем: ${messages.length}`);

    // Сортируем по дате и берём самое свежее
    messages.sort((a, b) => {
      const dateA = new Date(a.attributes.date);
      const dateB = new Date(b.attributes.date);
      return dateB - dateA;
    });

    const latest = messages[0];
    console.log('Дата последнего письма:', latest.attributes.date);

    // Собираем все содержимое письма
    let emailBody = '';
    let htmlBody = '';

    if (latest.parts && latest.parts.length > 0) {
      for (const part of latest.parts) {
        if (part.body && typeof part.body === 'string') {
          emailBody += part.body + '\n';

          // Если это HTML часть
          if (part.which === 'HTML' || (part.which === 'TEXT' && part.body.includes('<'))) {
            htmlBody = part.body;
            console.log('HTML часть найдена, длина:', htmlBody.length);
          }
        }
      }
    }

    console.log('Части письма:', latest.parts ? latest.parts.map(p => p.which) : 'нет частей');

    await connection.end();
    console.log('IMAP соединение закрыто');

    if (!emailBody) {
      console.log('Содержимое письма не найдено');
      return res.status(500).json({
        error: 'Email body not found',
        debug: {
          messageCount: messages.length,
          latestDate: latest.attributes.date,
          partsCount: latest.parts ? latest.parts.length : 0
        }
      });
    }

    console.log('Содержимое письма найдено, длина:', emailBody.length);
    console.log('Превью содержимого:', emailBody.substring(0, 500));

    let link = null;

    // Способ 1: Поиск всех HTTP/HTTPS ссылок в тексте
    const urlRegex = /https?:\/\/[^\s<>"'\n\r\t]+/gi;
    const matches = emailBody.match(urlRegex);

    if (matches && matches.length > 0) {
      console.log('Найденные ссылки:', matches);

      // Приоритет: ссылки с blsinternational
      link = matches.find(url => url.includes('blsinternational')) || matches[0];
      console.log('Выбранная ссылка (способ 1):', link);
    }

    // Способ 2: Если есть HTML, парсим через cheerio
    if (!link && htmlBody) {
      console.log('Парсим HTML содержимое...');
      const $ = load(htmlBody);

      // Ищем все ссылки
      const links = [];
      $('a[href]').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.startsWith('http')) {
          links.push(href);
        }
      });

      console.log('Ссылки из HTML:', links);

      if (links.length > 0) {
        link = links.find(url => url.includes('blsinternational')) || links[0];
        console.log('Выбранная ссылка (способ 2):', link);
      }
    }

    // Способ 3: Поиск закодированных ссылок
    if (!link) {
      console.log('Ищем закодированные ссылки...');

      // Ищем base64 или URL-encoded ссылки
      const encodedRegex = /[A-Za-z0-9+\/=]{50,}/g;
      const encodedMatches = emailBody.match(encodedRegex);

      if (encodedMatches) {
        console.log('Найдены возможные закодированные данные:', encodedMatches.length);

        for (const encoded of encodedMatches) {
          try {
            // Пробуем декодировать как base64
            const decoded = Buffer.from(encoded, 'base64').toString('utf8');
            if (decoded.includes('http')) {
              const decodedUrls = decoded.match(urlRegex);
              if (decodedUrls && decodedUrls.length > 0) {
                link = decodedUrls[0];
                console.log('Найдена декодированная ссылка:', link);
                break;
              }
            }
          } catch (e) {
            // Игнорируем ошибки декодирования
          }
        }
      }
    }

    // Способ 4: Поиск ссылок без протокола
    if (!link) {
      console.log('Ищем ссылки без протокола...');

      const domainRegex = /(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}[^\s<>"'\n\r\t]*/gi;
      const domainMatches = emailBody.match(domainRegex);

      if (domainMatches) {
        console.log('Найденные домены:', domainMatches);

        const blsDomain = domainMatches.find(domain => domain.includes('blsinternational'));
        if (blsDomain) {
          link = blsDomain.startsWith('http') ? blsDomain : 'https://' + blsDomain;
          console.log('Найдена ссылка по домену:', link);
        }
      }
    }

    console.log('Финальная найденная ссылка:', link);

    if (!link) {
      console.log('Ссылка не найдена в письме');
      return res.status(500).json({
        error: 'Verification link not found',
        debug: {
          bodyLength: emailBody.length,
          bodyPreview: emailBody.substring(0, 1000),
          containsHtml: emailBody.includes('<html'),
          containsHttp: emailBody.includes('http'),
          containsBls: emailBody.includes('blsinternational'),
          urlMatches: emailBody.match(urlRegex) || []
        }
      });
    }

    // Возвращаем ссылку
    console.log('Ссылка успешно найдена и отправлена');
    res.json({ link });

  } catch (err) {
    console.error('IMAP Error:', err);

    if (connection) {
      try {
        await connection.end();
      } catch (closeErr) {
        console.error('Ошибка при закрытии соединения:', closeErr);
      }
    }

    let errorMessage = err.message;
    if (err.textCode === 'AUTHENTICATIONFAILED') {
      errorMessage = 'Неверный email или пароль для IMAP';
    } else if (err.message.includes('timeout')) {
      errorMessage = 'Таймаут подключения к IMAP серверу';
    } else if (err.message.includes('ENOTFOUND')) {
      errorMessage = 'IMAP сервер недоступен';
    } else if (err.message.includes('Invalid BODY')) {
      errorMessage = 'Ошибка формата IMAP запроса';
    }

    res.status(500).json({
      error: errorMessage,
      details: err.message
    });
  }
});

app.get('/', (req, res) => {
  res.send('Firstmail IMAP API up and running');
});

app.get('/test', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    server: 'imap.firstmail.ltd:993'
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
  console.log(`Test endpoint: http://localhost:${port}/test`);
});
