import express from 'express';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/mail', async (req, res) => {
    const { email, password, subject, sender } = req.body;
    
    // Устанавливаем значения по умолчанию
    const searchSubject = subject || 'Slovakia Visa Appointment Booking Link';
    const searchSender = sender || 'noreply.app@blsinternational.com';
    
    console.log(`🔍 Поиск письма с темой: "${searchSubject}" от отправителя: "${searchSender}"`);

    if (!email || !password) {
        return res.status(400).json({ 
            error: 'Email и password обязательны',
            message: 'Не указаны данные для подключения к почте'
        });
    }

    const imap = new Imap({
        user: email,
        password: password,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
    });

    try {
        await new Promise((resolve, reject) => {
            imap.once('ready', () => {
                console.log('✅ IMAP подключение установлено');
                resolve();
            });

            imap.once('error', (err) => {
                console.error('❌ Ошибка IMAP подключения:', err);
                reject(err);
            });

            imap.connect();
        });

        // Открываем папку INBOX
        await new Promise((resolve, reject) => {
            imap.openBox('INBOX', false, (err, box) => {
                if (err) {
                    console.error('❌ Ошибка открытия INBOX:', err);
                    reject(err);
                } else {
                    console.log('📬 INBOX открыт, всего писем:', box.messages.total);
                    resolve(box);
                }
            });
        });

        // Создаем критерии поиска
        const searchCriteria = [
            'UNSEEN', // Только непрочитанные письма
            ['SUBJECT', searchSubject],
            ['FROM', searchSender]
        ];

        console.log('🔍 Критерии поиска:', searchCriteria);

        // Ищем письма
        const uids = await new Promise((resolve, reject) => {
            imap.search(searchCriteria, (err, results) => {
                if (err) {
                    console.error('❌ Ошибка поиска:', err);
                    reject(err);
                } else {
                    console.log('📨 Найдено писем:', results.length);
                    resolve(results);
                }
            });
        });

        if (uids.length === 0) {
            imap.end();
            return res.json({ 
                message: `Письма с темой "${searchSubject}" от "${searchSender}" не найдены`,
                found: false
            });
        }

        // Берем самое последнее письмо
        const latestUid = Math.max(...uids);
        console.log('📧 Обрабатываем письмо с UID:', latestUid);

        // Получаем письмо
        const emailData = await new Promise((resolve, reject) => {
            const fetch = imap.fetch([latestUid], { bodies: '' });
            let emailContent = '';

            fetch.on('message', (msg) => {
                msg.on('body', (stream) => {
                    let buffer = '';
                    stream.on('data', (chunk) => {
                        buffer += chunk.toString('utf8');
                    });
                    stream.once('end', () => {
                        emailContent = buffer;
                    });
                });
            });

            fetch.once('error', (err) => {
                console.error('❌ Ошибка получения письма:', err);
                reject(err);
            });

            fetch.once('end', () => {
                console.log('✅ Письмо получено');
                resolve(emailContent);
            });
        });

        // Парсим письмо
        const parsed = await simpleParser(emailData);
        console.log('📋 Тема письма:', parsed.subject);
        console.log('📤 От:', parsed.from?.text);

        // Ищем ссылку в письме
        let link = null;
        const content = parsed.html || parsed.text || '';
        
        // Различные паттерны для поиска ссылок
        const linkPatterns = [
            /https?:\/\/[^\s<>"']+blsinternational\.com[^\s<>"']*/gi,
            /https?:\/\/url\d+\.blsinternational\.com[^\s<>"']*/gi,
            /https?:\/\/[^\s<>"']*appointment[^\s<>"']*/gi,
            /https?:\/\/[^\s<>"']*booking[^\s<>"']*/gi
        ];

        for (const pattern of linkPatterns) {
            const matches = content.match(pattern);
            if (matches && matches.length > 0) {
                // Берем первую найденную ссылку
                link = matches[0];
                // Очищаем ссылку от возможных HTML символов
                link = link.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                console.log('🔗 Найдена ссылка:', link);
                break;
            }
        }

        // Помечаем письмо как прочитанное
        imap.addFlags([latestUid], ['\\Seen'], (err) => {
            if (err) {
                console.error('❌ Ошибка пометки письма как прочитанного:', err);
            } else {
                console.log('✅ Письмо помечено как прочитанное');
            }
        });

        imap.end();

        if (link) {
            console.log('✅ Ссылка успешно извлечена:', link);
            res.json({ 
                link: link,
                found: true,
                subject: parsed.subject,
                from: parsed.from?.text
            });
        } else {
            console.log('❌ Ссылка не найдена в письме');
            res.json({ 
                message: 'Ссылка не найдена в письме',
                found: false,
                subject: parsed.subject,
                from: parsed.from?.text
            });
        }

    } catch (error) {
        console.error('❌ Общая ошибка:', error);
        
        if (imap.state !== 'disconnected') {
            imap.end();
        }

        res.status(500).json({ 
            error: 'Ошибка обработки почты',
            message: error.message,
            found: false
        });
    }
});

// Дополнительный эндпоинт для проверки статуса сервера
app.get('/status', (req, res) => {
    res.json({ 
        status: 'active',
        message: 'IMAP сервер работает',
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 IMAP сервер запущен на порту ${PORT}`);
    console.log(`📧 Поддерживает фильтрацию по теме и отправителю`);
});

export default app;
