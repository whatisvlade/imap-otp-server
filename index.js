import express from 'express';
import Imap from 'imap-simple';
import cors from 'cors';
import cheerio from 'cheerio';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/mail', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
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

    // Ищем письма от нужного отправителя и с нужной темой
    const criteria = [
      ['FROM', 'noreply.app@blsinternational.com'],
      ['SUBJECT', 'OTP Confirmation']
    ];
    const fetchOptions = {
      bodies: ['HEADER.FIELDS (DATE)', 'HTML'],
      struct: true,
      markSeen: false
    };
    const messages = await connection.search(criteria, fetchOptions);

    if (!messages.length) {
      await connection.end();
      return res.json({ message: "No OTP Confirmation emails found" });
    }

    // Берём самое свежее
    const latest = messages[messages.length - 1];
    const htmlPart = latest.parts.find(p => p.which === 'HTML');
    const html = htmlPart?.body || '';

    await connection.end();

    if (!html) {
      return res.status(500).json({ error: "HTML body not found" });
    }

    // Парсим HTML и вытаскиваем ссылку
    const $ = cheerio.load(html);
    const link = $('a')
      .filter((i, el) => $(el).text().trim().includes('Click here'))
      .attr('href');

    if (!link) {
      return res.status(500).json({ error: "Verification link not found" });
    }

    // Возвращаем только ссылку
    res.json({ link });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('Firstmail IMAP API up');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server started on port ${port}`));
