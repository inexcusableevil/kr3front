const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const socketIo = require('socket.io');
const webpush = require('web-push');

const vapidKeys = {
    publicKey: 'BN5peT4hKdkQjL_kpnv4W6axa-DfZ_TAt_RNy-8hTq6Pd4od8yxxESXJy7SX6AzbZHe9Ou_PS1h6w6AKE8Zm6Yc',
    privateKey: 'NCEsOXLqJIejESvgsE-pN5HAj7l_sNjiJUDE8szP0tc'
};

webpush.setVapidDetails(
    'mailto:test@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

function createServer() {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname)));

    const subscriptions = new Map();
    const reminders = new Map();

    const server = http.createServer(app);
    const io = socketIo(server, {
        cors: { origin: '*', methods: ['GET', 'POST'] }
    });

    function broadcastPush(payload) {
        const jobs = [];

        for (const [endpoint, subscription] of subscriptions.entries()) {
            const job = webpush.sendNotification(subscription, JSON.stringify(payload)).catch(error => {
                const statusCode = error.statusCode || 0;
                console.error('Push error:', error.message || error);

                if (statusCode === 404 || statusCode === 410) {
                    subscriptions.delete(endpoint);
                }
            });

            jobs.push(job);
        }

        return Promise.allSettled(jobs);
    }

    function scheduleReminder(note) {
        if (!note.reminder) {
            return;
        }

        const delay = note.reminder - Date.now();
        if (delay <= 0) {
            return;
        }

        const existingReminder = reminders.get(note.id);
        if (existingReminder) {
            clearTimeout(existingReminder.timeoutId);
        }

        const timeoutId = setTimeout(async () => {
            await broadcastPush({
                title: 'Напоминание',
                body: note.text,
                reminderId: note.id
            });

            reminders.delete(note.id);
        }, delay);

        reminders.set(note.id, {
            note,
            timeoutId
        });
    }

    io.on('connection', socket => {
        console.log('Клиент подключён:', socket.id);

        socket.on('createNote', note => {
            if (!note || typeof note.text !== 'string' || !note.text.trim()) {
                return;
            }

            const normalizedNote = {
                id: Number(note.id) || Date.now(),
                text: note.text.trim(),
                reminder: note.reminder ? Number(note.reminder) : null,
                createdAt: Number(note.createdAt) || Date.now()
            };

            io.emit('noteCreated', normalizedNote);

            if (normalizedNote.reminder) {
                scheduleReminder(normalizedNote);
            } else {
                broadcastPush({
                    title: 'Новая задача',
                    body: normalizedNote.text
                });
            }
        });

        socket.on('disconnect', () => {
            console.log('Клиент отключён:', socket.id);
        });
    });

    app.post('/subscribe', (req, res) => {
        const subscription = req.body;
        if (!subscription?.endpoint) {
            return res.status(400).json({ error: 'Invalid subscription' });
        }

        subscriptions.set(subscription.endpoint, subscription);
        return res.status(201).json({ message: 'Подписка сохранена' });
    });

    app.post('/unsubscribe', (req, res) => {
        const endpoint = req.body?.endpoint;
        if (!endpoint) {
            return res.status(400).json({ error: 'Endpoint is required' });
        }

        subscriptions.delete(endpoint);
        return res.status(200).json({ message: 'Подписка удалена' });
    });

    app.post('/snooze', async (req, res) => {
        const reminderId = Number(req.query.reminderId);
        const reminder = reminders.get(reminderId);

        if (!reminder) {
            return res.status(404).json({ error: 'Reminder not found' });
        }

        clearTimeout(reminder.timeoutId);

        const snoozedReminder = {
            ...reminder.note,
            reminder: Date.now() + 5 * 60 * 1000
        };

        scheduleReminder(snoozedReminder);
        reminders.set(reminderId, { ...reminders.get(reminderId), note: snoozedReminder });

        await broadcastPush({
            title: 'Напоминание отложено',
            body: `"${snoozedReminder.text}" снова придёт через 5 минут.`
        });

        return res.status(200).json({ message: 'Reminder snoozed for 5 minutes' });
    });

    app.get('/api/health', (req, res) => {
        res.json({
            ok: true,
            subscriptions: subscriptions.size,
            reminders: reminders.size
        });
    });

    return server;
}

if (require.main === module) {
    const PORT = Number(process.env.PORT) || 3001;
    const server = createServer();
    server.listen(PORT, () => {
        console.log(`Сервер запущен на http://localhost:${PORT}`);
    });
}

module.exports = { createServer };
