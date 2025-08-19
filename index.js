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

  const config = {
    imap: {
      user: email,
      password,
      host: 'imap.firstmail.ltd',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 5000
    }
  };

  try {
    const connection = await Imap.connect(config);
    await connection.openBox('INBOX');

    // Ищем письма от noreply.app@blsinternational.com с темой OTP Confirmation
    const criteria = [
      ['FROM', 'noreply.app@blsinternational.com'],
      ['SUBJECT', 'OTP Confirmation']
    ];
    const fetchOptions = {
      bodies: ['HEADER.FIELDS (DATE)', 'HTML', 'TEXT'],
      struct: true,
      markSeen: false
    };

    const messages = await connection.search(criteria, fetchOptions);
    if (!messages.length) {
      await connection.end();
      return res.json({ message: 'No OTP Confirmation emails found' });
    }

    // Сортируем по дате и берём самое свежее (последнее)
    messages.sort((a, b) => {
      const dateA = new Date(a.attributes.date);
      const dateB = new Date(b.attributes.date);
      return dateB - dateA; // Сортировка по убыванию (новые сначала)
    });

    const latest = messages[0]; // Самое свежее письмо
    console.log('Найдено писем:', messages.length);
    console.log('Дата последнего письма:', latest.attributes.date);

    // Ищем HTML часть письма
    let htmlPart = latest.parts.find(p => p.which === 'HTML');
    let html = htmlPart?.body || '';

    // Если HTML нет, пробуем TEXT
    if (!html) {
      const textPart = latest.parts.find(p => p.which === 'TEXT');
      html = textPart?.body || '';
    }

    await connection.end();

    if (!html) {
      return res.status(500).json({ error: 'HTML/TEXT body not found' });
    }

    console.log('HTML содержимое письма:', html.substring(0, 500) + '...');

    // Парсим HTML и вытаскиваем ссылку
    const $ = load(html);
    
    // Ищем ссылку разными способами
    let link = null;

    // Способ 1: Ищем по тексту "Click here"
    link = $('a').filter((i, el) => {
      const text = $(el).text().trim().toLowerCase();
      return text.includes('click here') || text.includes('verification code');
    }).attr('href');

    // Способ 2: Если не найдено, ищем любую ссылку с доменом blsinternational
    if (!link) {
      link = $('a[href*="blsinternational"]').attr('href');
    }

    // Способ 3: Ищем любую HTTP ссылку
    if (!link) {
      link = $('a[href^="http"]').first().attr('href');
    }

    // Способ 4: Поиск в тексте с помощью регулярного выражения
    if (!link) {
      const urlRegex = /https?:\/\/[^\s<>"]+/gi;
      const matches = html.match(urlRegex);
      if (matches && matches.length > 0) {
        // Берем первую найденную ссылку
        link = matches[0];
      }
    }

    console.log('Найденная ссылка:', link);

    if (!link) {
      return res.status(500).json({ 
        error: 'Verification link not found',
        debug: {
          htmlLength: html.length,
          htmlPreview: html.substring(0, 200)
        }
      });
    }

    // Возвращаем ссылку
    res.json({ link });
  } catch (err) {
    console.error('IMAP Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('Firstmail IMAP API up');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server started on port ${port}`));
