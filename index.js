import express from 'express';
import Imap from 'imap-simple';
import cheerio from 'cheerio';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

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
      host: process.env.IMAP_HOST || 'imap.firstmail.ltd',
      port: Number(process.env.IMAP_PORT) || 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 5000
    }
  };

  try {
    // подключаемся к IMAP
    const connection = await Imap.connect(config);
    await connection.openBox('INBOX');

    // ищем письма от нужного отправителя с темой OTP Confirmation
    const searchCriteria = [
      ['FROM', 'noreply.app@blsinternational.com'],
      ['SUBJECT', 'OTP Confirmation']
    ];
    const fetchOptions = {
      bodies: ['HEADER.FIELDS (DATE)', 'HTML'],
      struct: true,
      markSeen: false
    };
    const results = await connection.search(searchCriteria, fetchOptions);

    if (!results.length) {
      await connection.end();
      return res.json({ message: 'No OTP Confirmation emails found' });
    }

    // берём самое свежее письмо
    const latest = results[results.length - 1];
    const htmlPart = latest.parts.find(p => p.which === 'HTML');
    const html = htmlPart?.body || '';
    await connection.end();

    if (!html) {
      return res.status(500).json({ error: 'HTML body not found' });
    }

    // парсим HTML и ищем ссылку
    const $ = cheerio.load(html);
    const link = $('a')
      .filter((i, el) => $(el).text().trim().includes('Click here'))
      .attr('href');

    if (!link) {
      return res.status(500).json({ error: 'Verification link not found' });
    }

    // возвращаем ссылку
    res.json({ link });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
