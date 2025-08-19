import express from 'express';
import Imap from 'imap-simple';
import cors from 'cors';
import { load } from 'cheerio';

const app = express();
app.use(cors());
app.use(express.json());

// Улучшенная функция для очистки и декодирования URL
function cleanAndDecodeUrl(url) {
  if (!url) return null;
  
  try {
    // Убираем лишние пробелы
    let cleanUrl = url.trim();
    
    // Убираем все после '3D'http:// или подобных конструкций
    cleanUrl = cleanUrl.replace(/3D'http:\/\/.*$/, '');
    cleanUrl = cleanUrl.replace(/3D"http:\/\/.*$/, '');
    
    // Убираем все после = в конце
    cleanUrl = cleanUrl.replace(/=\s*$/, '');
    
    // Декодируем URL если он закодирован
    if (cleanUrl.includes('%')) {
      cleanUrl = decodeURIComponent(cleanUrl);
    }
    
    // Убираем лишние символы в конце (все что не буквы, цифры или допустимые URL символы)
    cleanUrl = cleanUrl.replace(/[^a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+$/, '');
    
    // Проверяем что это валидный URL
    new URL(cleanUrl);
    
    console.log('URL очищен:', url.substring(0, 100) + '...', '->', cleanUrl);
    return cleanUrl;
  } catch (e) {
    console.log('Ошибка очистки URL:', e.message);
    
    // Попробуем более агрессивную очистку
    try {
      let fallbackUrl = url.trim();
      
      // Ищем основную часть URL до первого проблемного символа
      const match = fallbackUrl.match(/(https?:\/\/[^'"\s<>=]+)/);
      if (match) {
        fallbackUrl = match[1];
        // Убираем trailing символы
        fallbackUrl = fallbackUrl.replace(/[^a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+$/, '');
        new URL(fallbackUrl);
        console.log('URL очищен (fallback):', fallbackUrl);
        return fallbackUrl;
      }
    } catch (e2) {
      console.log('Fallback очистка тоже не удалась');
    }
    
    return null;
  }
}

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

    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''], // Только рабочие секции
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
        return text.includes('click here') || text.includes('verification') || text.includes('verify');
      }).attr('href');

      if (clickHereLink) {
        link = cleanAndDecodeUrl(clickHereLink);
        console.log('Найдена ссылка "Click here":', clickHereLink.substring(0, 100) + '...', '->', link);
      }

      // Если не найдено, ищем ссылку с email_otp_verify (правильная ссылка)
      if (!link) {
        const otpVerifyLink = $('a[href*="email_otp_verify"]').attr('href');
        if (otpVerifyLink) {
          link = cleanAndDecodeUrl(otpVerifyLink);
          console.log('Найдена ссылка email_otp_verify:', otpVerifyLink.substring(0, 100) + '...', '->', link);
        }
      }

      // Если не найдено, ищем любую ссылку с blsinternational
      if (!link) {
        const blsLink = $('a[href*="blsinternational"]').attr('href');
        if (blsLink) {
          link = cleanAndDecodeUrl(blsLink);
          console.log('Найдена BLS ссылка:', blsLink.substring(0, 100) + '...', '->', link);
        }
      }

      // Выводим все найденные ссылки для отладки
      const allLinks = [];
      $('a[href]').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        allLinks.push({
          original: href ? href.substring(0, 100) + '...' : null,
          text: text,
          isOtpVerify: href ? href.includes('email_otp_verify') : false
        });
      });
      console.log('Все ссылки в HTML:', allLinks);
    }

    // Способ 2: Поиск ссылок в тексте регулярными выражениями
    if (!link) {
      console.log('Ищем ссылки в тексте...');
      
      // Сначала ищем ссылки с email_otp_verify
      const otpVerifyRegex = /https?:\/\/[^\s<>"'\n\r\t]*email_otp_verify[^\s<>"'\n\r\t]*/gi;
      const otpMatches = emailBody.match(otpVerifyRegex);
      
      if (otpMatches && otpMatches.length > 0) {
        console.log('Найденные OTP verify ссылки:', otpMatches.map(u => u.substring(0, 100) + '...'));
        link = cleanAndDecodeUrl(otpMatches[0]);
        console.log('Выбранная OTP verify ссылка:', link);
      } else {
        // Если не найдено, ищем любые ссылки
        const urlRegex = /https?:\/\/[^\s<>"'\n\r\t]+/gi;
        const matches = emailBody.match(urlRegex);

        if (matches && matches.length > 0) {
          console.log('Найденные ссылки в тексте:', matches.map(u => u.substring(0, 100) + '...'));
          const rawLink = matches.find(url => url.includes('blsinternational')) || matches[0];
          link = cleanAndDecodeUrl(rawLink);
          console.log('Выбранная ссылка из текста:', link);
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
          containsBls: emailBody.includes('blsinternational'),
          containsOtpVerify: emailBody.includes('email_otp_verify')
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
