import express from 'express';
import Imap from 'imap-simple';
import cors from 'cors';
import { load } from 'cheerio';

const app = express();
app.use(cors());
app.use(express.json());

// Функция для декодирования Quoted-Printable
function decodeQuotedPrintable(str) {
  if (!str) return str;
  
  return str
    .replace(/=\r?\n/g, '') // Убираем мягкие переносы строк
    .replace(/=([0-9A-F]{2})/gi, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/=3D/g, '=') // Специально для =3D -> =
    .replace(/=20/g, ' ') // Пробелы
    .replace(/=09/g, '\t'); // Табы
}

// Функция для извлечения полной ссылки верификации OTP
function extractVerificationLink(htmlContent, textContent) {
  console.log('🔍 Извлекаем ссылку верификации OTP...');
  console.log('📊 Размеры контента: HTML =', htmlContent?.length || 0, 'TEXT =', textContent?.length || 0);

  // ДЕКОДИРУЕМ Quoted-Printable ПЕРЕД поиском!
  if (htmlContent && htmlContent.includes('=3D')) {
    console.log('🔧 Декодируем Quoted-Printable в HTML контенте...');
    const originalLength = htmlContent.length;
    htmlContent = decodeQuotedPrintable(htmlContent);
    console.log('📏 Размер после декодирования:', originalLength, '->', htmlContent.length);
    
    // Показываем фрагмент после декодирования
    const blsIndex = htmlContent.indexOf('blsinternational');
    if (blsIndex !== -1) {
      const start = Math.max(0, blsIndex - 200);
      const end = Math.min(htmlContent.length, blsIndex + 1000);
      console.log('🔍 HTML фрагмент ПОСЛЕ декодирования:');
      console.log(htmlContent.substring(start, end));
    }
  }

  if (textContent && textContent.includes('=3D')) {
    console.log('🔧 Декодируем Quoted-Printable в текстовом контенте...');
    textContent = decodeQuotedPrintable(textContent);
  }

  let link = null;

  if (htmlContent) {
    // ОТЛАДКА: показываем фрагмент HTML с blsinternational
    const blsIndex = htmlContent.indexOf('blsinternational');
    if (blsIndex !== -1) {
      const start = Math.max(0, blsIndex - 100);
      const end = Math.min(htmlContent.length, blsIndex + 800);
      console.log('🔍 HTML фрагмент с blsinternational:');
      console.log(htmlContent.substring(start, end));
    }

    // ОТЛАДКА: показываем все href с blsinternational
    console.log('🔍 Поиск всех href с blsinternational:');
    const hrefRegex = /href=["']([^"']*blsinternational[^"']*)["']/gi;
    let match;
    while ((match = hrefRegex.exec(htmlContent)) !== null) {
      console.log('Найденный href:', match[1]);
      console.log('Длина href:', match[1].length);
    }

    // Основной поиск - ИСПРАВЛЕННЫЙ regex для захвата ВСЕЙ ссылки
    const hrefMatch = htmlContent.match(/href=["']([^"']*blsinternational\.com[^"']*)["']/i);
    if (hrefMatch) {
      link = hrefMatch[1];
      console.log('✅ Найдена полная ссылка в HTML:', link);
      console.log('📏 Длина найденной ссылки:', link.length);
    }

    // Если не найдена через href, ищем прямо в тексте HTML
    if (!link) {
      console.log('🔍 Поиск через regex в HTML тексте...');
      const urlMatch = htmlContent.match(/(https?:\/\/[^\s"'<>]*blsinternational\.com[^\s"'<>]*)/i);
      if (urlMatch) {
        link = urlMatch[1];
        console.log('✅ Найдена ссылка через regex в HTML:', link);
        console.log('📏 Длина найденной ссылки:', link.length);
      }
    }
  }

  // Поиск в текстовом содержимом
  if (!link && textContent) {
    console.log('🔍 Поиск в текстовом содержимом...');
    const textUrlMatch = textContent.match(/(https?:\/\/[^\s]*blsinternational\.com[^\s]*)/i);
    if (textUrlMatch) {
      link = textUrlMatch[1];
      console.log('✅ Найдена ссылка в тексте:', link);
      console.log('📏 Длина найденной ссылки:', link.length);
    }
  }

  if (link) {
    console.log('🔗 Ссылка ДО обработки:', link);

    // ВАЖНО: Декодируем только HTML entities, НЕ трогаем URL-параметры!
    const originalLink = link;
    link = link.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

    console.log('🔗 Ссылка ПОСЛЕ декодирования HTML entities:', link);
    console.log('📏 Изменение длины:', originalLink.length, '->', link.length);

    // Убираем возможные лишние символы в конце
    const beforeCleanup = link;
    link = link.replace(/[>\]}\)]*$/, '');

    if (beforeCleanup !== link) {
      console.log('🧹 Убрали лишние символы в конце:', beforeCleanup, '->', link);
    }

    console.log('🔗 Финальная ссылка:', link);
    console.log('📏 Финальная длина:', link.length);

    // ПРОВЕРКА: если ссылка слишком короткая, это проблема
    if (link.length < 100) {
      console.warn('⚠️ ВНИМАНИЕ: Ссылка подозрительно короткая!');
    }

    return link;
  }

  console.log('❌ Ссылка не найдена');
  return null;
}

// Функция для извлечения ссылки на запись из письма о записи на визу
function extractAppointmentLink(htmlContent, textContent) {
  console.log('🔍 Извлекаем ссылку на запись из письма о визе Словакии...');
  console.log('📊 Размеры контента: HTML =', htmlContent?.length || 0, 'TEXT =', textContent?.length || 0);

  // ДЕКОДИРУЕМ Quoted-Printable ПЕРЕД поиском!
  if (htmlContent && htmlContent.includes('=3D')) {
    console.log('🔧 Декодируем Quoted-Printable в HTML контенте...');
    htmlContent = decodeQuotedPrintable(htmlContent);
  }

  if (textContent && textContent.includes('=3D')) {
    console.log('🔧 Декодируем Quoted-Printable в текстовом контенте...');
    textContent = decodeQuotedPrintable(textContent);
  }

  let link = null;

  // Паттерны для поиска ссылок на запись
  const appointmentPatterns = [
    // Прямые ссылки на blsinternational с appointment в URL
    /(https?:\/\/[^\s"'<>]*blsinternational\.com[^\s"'<>]*appointment[^\s"'<>]*)/i,
    // Ссылки на blsinternational с booking в URL
    /(https?:\/\/[^\s"'<>]*blsinternational\.com[^\s"'<>]*booking[^\s"'<>]*)/i,
    // Ссылки на blsinternational с visa в URL
    /(https?:\/\/[^\s"'<>]*blsinternational\.com[^\s"'<>]*visa[^\s"'<>]*)/i,
    // Любые длинные ссылки на blsinternational (с параметрами)
    /(https?:\/\/[^\s"'<>]*blsinternational\.com[^\s"'<>]{50,})/i,
    // Общий паттерн для blsinternational
    /(https?:\/\/[^\s"'<>]*blsinternational\.com[^\s"'<>]*)/i
  ];

  // Поиск в HTML контенте
  if (htmlContent) {
    console.log('🔍 Поиск в HTML контенте...');
    
    // Сначала ищем в href атрибутах
    const hrefMatches = htmlContent.match(/href=["']([^"']*blsinternational\.com[^"']*)["']/gi);
    if (hrefMatches) {
      console.log('🔗 Найденные href ссылки:', hrefMatches);
      // Берем самую длинную ссылку (скорее всего с параметрами)
      for (const hrefMatch of hrefMatches) {
        const urlMatch = hrefMatch.match(/href=["']([^"']*)["']/i);
        if (urlMatch && urlMatch[1]) {
          const candidateLink = urlMatch[1];
          if (!link || candidateLink.length > link.length) {
            link = candidateLink;
          }
        }
      }
    }

    // Если не найдено в href, ищем по паттернам в тексте HTML
    if (!link) {
      for (const pattern of appointmentPatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          link = match[1];
          console.log('✅ Найдена ссылка в HTML по паттерну:', pattern.toString());
          break;
        }
      }
    }
  }

  // Поиск в текстовом содержимом
  if (!link && textContent) {
    console.log('🔍 Поиск в текстовом содержимом...');
    for (const pattern of appointmentPatterns) {
      const match = textContent.match(pattern);
      if (match) {
        link = match[1];
        console.log('✅ Найдена ссылка в тексте по паттерну:', pattern.toString());
        break;
      }
    }
  }

  if (link) {
    console.log('🔗 Ссылка ДО обработки:', link);

    // Декодируем HTML entities
    const originalLink = link;
    link = link.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

    console.log('🔗 Ссылка ПОСЛЕ декодирования HTML entities:', link);

    // Убираем возможные лишние символы в конце
    link = link.replace(/[>\]}\)]*$/, '');

    console.log('🔗 Финальная ссылка на запись:', link);
    console.log('📏 Финальная длина:', link.length);

    return link;
  }

  console.log('❌ Ссылка на запись не найдена');
  return null;
}

// Общая функция для подключения к IMAP
async function connectToImap(email, password) {
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

  console.log('Подключаемся к IMAP серверу...');
  const connection = await Imap.connect(config);
  console.log('IMAP подключение установлено');

  await connection.openBox('INBOX');
  console.log('INBOX открыт');

  return connection;
}

// Общая функция для обработки писем
async function processEmails(connection, criteria, linkExtractor, emailType) {
  const fetchOptions = {
    bodies: ['HEADER', 'TEXT', ''], // Только рабочие секции
    struct: true,
    markSeen: false
  };

  console.log(`Ищем письма типа: ${emailType}...`);
  const messages = await connection.search(criteria, fetchOptions);

  if (!messages.length) {
    console.log(`Письма типа ${emailType} не найдены`);
    return { message: `No ${emailType} emails found` };
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

    // ОТЛАДКА: Показываем первые 1000 символов каждой части
    console.log('🔍 ОТЛАДКА: Показываем первые 1000 символов каждой части:');
    for (const part of latest.parts) {
      if (part.body && typeof part.body === 'string') {
        console.log(`\n--- Часть ${part.which} (${part.body.length} символов) ---`);
        console.log(part.body.substring(0, 1000));
        console.log('--- Конец части ---\n');
      }
    }

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

  if (!emailBody) {
    console.log('Содержимое письма не найдено');
    return {
      error: 'Email body not found',
      debug: {
        messageCount: messages.length,
        latestDate: latest.attributes.date,
        partsCount: latest.parts ? latest.parts.length : 0
      }
    };
  }

  console.log('Содержимое письма найдено, общая длина:', emailBody.length);

  console.log('Ищем ссылку...');
  let link = linkExtractor(htmlContent, emailBody);

  if (!link) {
    console.log('Ссылка не найдена через основную функцию, пробуем альтернативные методы...');

    // Альтернативный поиск в HTML
    if (htmlContent) {
      const $ = load(htmlContent);

      // Ищем любую ссылку с blsinternational (БЕЗ очистки!)
      const blsLink = $('a[href*="blsinternational"]').attr('href');
      if (blsLink) {
        link = blsLink;
        console.log('✅ Найдена BLS ссылка через cheerio:', link);
      }
    }

    // Поиск в тексте как последний вариант - максимально широкий поиск
    if (!link) {
      const urlRegex = /(https?:\/\/[^\s\n\r\t]+blsinternational\.com[^\s\n\r\t]*)/gi;
      const matches = emailBody.match(urlRegex);
      if (matches && matches.length > 0) {
        console.log('🔍 Все найденные ссылки в тексте:');
        matches.forEach((match, i) => {
          console.log(`  ${i + 1}. Длина: ${match.length}, URL: ${match.substring(0, 150)}...`);
        });

        // Берем самую длинную ссылку (скорее всего с параметрами)
        link = matches.reduce((longest, current) =>
          current.length > longest.length ? current : longest
        );
        console.log('✅ Выбрана самая длинная ссылка:', link.substring(0, 200) + '...');
      } else {
        console.log('❌ Никаких ссылок blsinternational не найдено в тексте');

        // Показываем первые 2000 символов email для отладки
        console.log('📧 Начало содержимого email:');
        console.log(emailBody.substring(0, 2000));
      }
    }
  }

  console.log('Финальная найденная ссылка:', link);

  if (!link) {
    console.log('Ссылка не найдена в письме');
    return {
      error: `${emailType} link not found`,
      debug: {
        bodyLength: emailBody.length,
        bodyPreview: emailBody.substring(0, 1000),
        hasHtmlContent: !!htmlContent,
        htmlContentLength: htmlContent.length,
        containsClickHere: emailBody.toLowerCase().includes('click here'),
        containsHttp: emailBody.includes('http'),
        containsBls: emailBody.includes('blsinternational'),
        containsOtpVerify: emailBody.includes('email_otp_verify'),
        containsAppointment: emailBody.toLowerCase().includes('appointment'),
        containsBooking: emailBody.toLowerCase().includes('booking')
      }
    };
  }

  // Возвращаем ссылку с дополнительной информацией
  return { 
    link,
    emailDate: latest.attributes.date,
    emailDescription: emailType
  };
}

// ENDPOINT для OTP писем (тема: "OTP Confirmation")
app.post('/mail/otp', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  console.log(`Попытка подключения к IMAP для OTP: ${email}`);

  let connection = null;

  try {
    connection = await connectToImap(email, password);

    // Ищем письма от noreply.app@blsinternational.com с темой OTP Confirmation
    const criteria = [
      ['FROM', 'noreply.app@blsinternational.com'],
      ['SUBJECT', 'OTP Confirmation']
    ];

    const result = await processEmails(connection, criteria, extractVerificationLink, 'OTP Confirmation');
    
    await connection.end();
    console.log('IMAP соединение закрыто');

    if (result.error) {
      return res.status(500).json(result);
    }

    if (result.message) {
      return res.json(result);
    }

    // Возвращаем ссылку
    console.log('OTP ссылка успешно найдена и отправлена');
    res.json(result);

  } catch (err) {
    console.error('IMAP Error (OTP):', err);

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

// ENDPOINT для писем о записи на визу (тема: "Slovakia Visa Appointment Booking Link")
app.post('/mail/appointment', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  console.log(`Попытка подключения к IMAP для Appointment: ${email}`);

  let connection = null;

  try {
    connection = await connectToImap(email, password);

    // Ищем письма с темой "Slovakia Visa Appointment Booking Link"
    const criteria = [
      ['SUBJECT', 'Slovakia Visa Appointment Booking Link']
    ];

    const result = await processEmails(connection, criteria, extractAppointmentLink, 'Slovakia Visa Appointment Booking Link');
    
    await connection.end();
    console.log('IMAP соединение закрыто');

    if (result.error) {
      return res.status(500).json(result);
    }

    if (result.message) {
      return res.json(result);
    }

    // Возвращаем ссылку
    console.log('Appointment ссылка успешно найдена и отправлена');
    res.json(result);

  } catch (err) {
    console.error('IMAP Error (Appointment):', err);

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

// LEGACY ENDPOINT для обратной совместимости
app.post('/mail', async (req, res) => {
  console.log('⚠️ Используется устаревший endpoint /mail, перенаправляем на /mail/otp');
  // Перенаправляем на новый OTP endpoint
  req.url = '/mail/otp';
  return app._router.handle(req, res);
});

app.get('/', (req, res) => {
  res.send('Firstmail IMAP API up and running - Updated with specialized endpoints');
});

app.get('/test', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    server: 'imap.firstmail.ltd:993',
    endpoints: {
      otp: '/mail/otp - для писем с темой "OTP Confirmation"',
      appointment: '/mail/appointment - для писем с темой "Slovakia Visa Appointment Booking Link"',
      legacy: '/mail - устаревший endpoint (перенаправляется на /mail/otp)'
    }
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
  console.log(`Test endpoint: http://localhost:${port}/test`);
  console.log('📧 Доступные endpoints:');
  console.log('  - POST /mail/otp - для OTP писем');
  console.log('  - POST /mail/appointment - для писем о записи на визу');
  console.log('  - POST /mail - legacy endpoint (перенаправляется на /mail/otp)');
});
