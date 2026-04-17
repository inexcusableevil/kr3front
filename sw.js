const CACHE_NAME = 'notes-cache-v7';
const APP_SHELL = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/content/home.html',
    '/content/about.html',
    '/socket.io/socket.io.js',
    '/icons/favicon.ico',
    '/icons/favicon-16x16.png',
    '/icons/favicon-32x32.png',
    '/icons/favicon-48x48.png',
    '/icons/favicon-64x64.png',
    '/icons/favicon-128x128.png',
    '/icons/favicon-256x256.png',
    '/icons/favicon-512x512.png',
    '/icons/icon-152x152.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') {
        return;
    }

    const requestUrl = new URL(event.request.url);
    const isSameOrigin = requestUrl.origin === self.location.origin;

    if (!isSameOrigin) {
        return;
    }

    if (requestUrl.pathname.startsWith('/socket.io/') && requestUrl.pathname !== '/socket.io/socket.io.js') {
        event.respondWith(fetch(event.request));
        return;
    }

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
                    return response;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    if (requestUrl.pathname.startsWith('/content/')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(event.request).then(response => {
                if (!response || response.status !== 200) {
                    return response;
                }

                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                return response;
            });
        })
    );
});

self.addEventListener('push', event => {
    let data = {
        title: 'Новое уведомление',
        body: '',
        reminderId: null
    };

    if (event.data) {
        data = event.data.json();
    }

    const options = {
        body: data.body,
        icon: '/icons/favicon-128x128.png',
        badge: '/icons/favicon-48x48.png',
        data: { reminderId: data.reminderId }
    };

    if (data.reminderId) {
        options.actions = [
            { action: 'snooze', title: 'Отложить на 5 минут' }
        ];
    }

    event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', event => {
    const { action, notification } = event;
    const reminderId = notification.data?.reminderId;

    if (action === 'snooze' && reminderId) {
        event.waitUntil(
            fetch(`/snooze?reminderId=${reminderId}`, { method: 'POST' })
                .then(() => notification.close())
                .catch(error => {
                    console.error('Snooze failed:', error);
                    notification.close();
                })
        );
        return;
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            notification.close();

            for (const client of windowClients) {
                if ('focus' in client) {
                    return client.focus();
                }
            }

            if (clients.openWindow) {
                return clients.openWindow('/');
            }

            return undefined;
        })
    );
});
