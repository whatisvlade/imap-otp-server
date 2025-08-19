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

    // ИСПРАВЛЕННЫЕ fetchOptions - используем только поддерживаемые секции
    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''], // Только поддерживаемые секции
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
    let htmlContent = '';

    if (latest.parts && latest.parts.length > 0) {
      console.log('Части письма:', latest.parts.map(p => ({ which: p.which, size: p.body ? p.body.length : 0 })));
      
      for (const part of latest.parts) {
        if (part.body && typeof part.body === 'string') {
          emailBody += part.body + '\n';
          
          // Ищем HTML контент в любой части
          if (part.body.includes('<html') || part.body.includes('<a href') || part.body.includes('<table')) {
            htmlContent = part.body;
            console.log('HTML контент найден в части:', part.which, 'длина:', htmlContent.length);
          }
        }
      }
    }

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

    console.log('Содержимое письма найдено, общая длина:', emailBody.length);

    let link = null;

    // Способ 1: Если найден HTML контент, парсим его
    if (htmlContent) {
      console.log('Парсим HTML контент...');
      const $ = load(htmlContent);

      // Ищем ссылку с текстом "Click here"
      const clickHereLink = $('a').filter((i, el) => {
        const text = $(el).text().trim().toLowerCase();
        return text.includes('click here') || text.includes('verification');
      }).attr('href');

      if (clickHereLink) {
        link = clickHereLink;
        console.log('Найдена ссылка "Click here":', link);
      } else {
        // Ищем любую ссылку с blsinternational
        const blsLink = $('a[href*="blsinternational"]').attr('href');
        if (blsLink) {
          link = blsLink;
          console.log('Найдена BLS ссылка:', link);
        } else {
          // Ищем любую HTTP ссылку
          const anyLink = $('a[href^="http"]').first().attr('href');
          if (anyLink) {
            link = anyLink;
            console.log('Найдена любая HTTP ссылка:', link);
          }
        }
      }

      // Выводим все найденные ссылки для отладки
      const allLinks = [];
      $('a[href]').each((i, el) => {
        allLinks.push({
          href: $(el).attr('href'),
          text: $(el).text().trim()
        });
      });
      console.log('Все ссылки в HTML:', allLinks);
    }

    // Способ 2: Поиск ссылок в тексте регулярными выражениями
    if (!link) {
      console.log('Ищем ссылки в тексте...');
      const urlRegex = /https?:\/\/[^\s<>"'\n\r\t]+/gi;
      const matches = emailBody.match(urlRegex);

      if (matches && matches.length > 0) {
        console.log('Найденные ссылки в тексте:', matches);
        link = matches.find(url => url.includes('blsinternational')) || matches[0];
        console.log('Выбранная ссылка из текста:', link);
      }
    }

    // Способ 3: Поиск закодированных ссылок
    if (!link) {
      console.log('Ищем закодированные ссылки...');
      
      // Ищем возможные base64 строки
      const base64Regex = /[A-Za-z0-9+\/]{40,}={0,2}/g;
      const base64Matches = emailBody.match(base64Regex);
      
      if (base64Matches) {
        for (const encoded of base64Matches) {
          try {
            const decoded = Buffer.from(encoded, 'base64').toString('utf8');
            if (decoded.includes('http')) {
              const urlRegex = /https?:\/\/[^\s<>"'\n\r\t]+/gi;
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

    console.log('Финальная найденная ссылка:', link);

    if (!link) {
      console.log('Ссылка не найдена в письме');
      return res.status(500).json({
        error: 'Verification link not found',
        debug: {
          bodyLength: emailBody.length,
          bodyPreview: emailBody.substring(0, 1000),
          hasHtmlContent: !!htmlContent,
          htmlContentLength: htmlContent.length,
          containsClickHere: emailBody.toLowerCase().includes('click here'),
          containsHttp: emailBody.includes('http'),
          containsBls: emailBody.includes('blsinternational')
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
