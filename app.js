const NOTES_STORAGE_KEY = 'notes';
const HOME_PAGE = 'home';
const ABOUT_PAGE = 'about';
const API_BASE = window.location.origin;
const PUBLIC_VAPID_KEY = 'BN5peT4hKdkQjL_kpnv4W6axa-DfZ_TAt_RNy-8hTq6Pd4od8yxxESXJy7SX6AzbZHe9Ou_PS1h6w6AKE8Zm6Yc';

const state = {
    currentPage: HOME_PAGE,
    socket: null,
    serviceWorkerReady: null,
    installPromptEvent: null
};

const contentDiv = document.getElementById('app-content');
const homeBtn = document.getElementById('home-btn');
const aboutBtn = document.getElementById('about-btn');
const enablePushBtn = document.getElementById('enable-push');
const disablePushBtn = document.getElementById('disable-push');
const appLaunchBtn = document.getElementById('app-launch');
const networkStatus = document.getElementById('network-status');
const swStatus = document.getElementById('sw-status');
const pushStatus = document.getElementById('push-status');
const appMessage = document.getElementById('app-message');

function isStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function readNotes() {
    const rawNotes = JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY) || '[]');

    if (!Array.isArray(rawNotes)) {
        return [];
    }

    return rawNotes.map(note => {
        if (typeof note === 'string') {
            return {
                id: Date.now() + Math.floor(Math.random() * 1000),
                text: note,
                reminder: null,
                createdAt: Date.now()
            };
        }

        return {
            id: Number(note.id) || Date.now(),
            text: String(note.text || '').trim(),
            reminder: note.reminder ? Number(note.reminder) : null,
            createdAt: Number(note.createdAt) || Date.now()
        };
    }).filter(note => note.text);
}

function writeNotes(notes) {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
}

function upsertNote(note) {
    const notes = readNotes();
    const existingIndex = notes.findIndex(item => item.id === note.id);

    if (existingIndex >= 0) {
        notes[existingIndex] = note;
    } else {
        notes.unshift(note);
    }

    notes.sort((a, b) => b.createdAt - a.createdAt);
    writeNotes(notes);
}

function clearNotes() {
    localStorage.removeItem(NOTES_STORAGE_KEY);
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString('ru-RU');
}

function escapeHtml(text) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function createNote(text, reminder = null) {
    return {
        id: Date.now() + Math.floor(Math.random() * 1000),
        text,
        reminder,
        createdAt: Date.now()
    };
}

function updateStatus() {
    networkStatus.textContent = navigator.onLine ? 'Онлайн' : 'Офлайн';
}

function setServiceWorkerStatus(text) {
    swStatus.textContent = text;
}

function setPushStatus(text) {
    pushStatus.textContent = text;
}

function setMessage(text) {
    appMessage.textContent = text;
}

function updateInstallButton() {
    if (!appLaunchBtn) {
        return;
    }

    if (isStandaloneMode()) {
        appLaunchBtn.hidden = true;
        return;
    }

    if (state.installPromptEvent) {
        appLaunchBtn.hidden = false;
        appLaunchBtn.textContent = 'Установить приложение';
        return;
    }

    appLaunchBtn.hidden = false;
    appLaunchBtn.textContent = 'Открыть приложение';
}

function showToast(message, type = '') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`.trim();
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(() => {
        toast.remove();
    }, 3200);
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let index = 0; index < rawData.length; index += 1) {
        outputArray[index] = rawData.charCodeAt(index);
    }

    return outputArray;
}

async function syncPushButtons() {
    if (!state.serviceWorkerReady || !('PushManager' in window)) {
        enablePushBtn.hidden = true;
        disablePushBtn.hidden = true;
        setPushStatus('Не поддерживается');
        return;
    }

    const registration = await state.serviceWorkerReady;
    const subscription = await registration.pushManager.getSubscription();
    const isSubscribed = Boolean(subscription);

    enablePushBtn.hidden = isSubscribed;
    disablePushBtn.hidden = !isSubscribed;
    setPushStatus(isSubscribed ? 'Подключён' : 'Не подключён');
}

async function subscribeToPush() {
    if (!state.serviceWorkerReady || !('PushManager' in window)) {
        showToast('Push API не поддерживается браузером.', 'warning');
        return;
    }

    if (Notification.permission === 'denied') {
        showToast('Уведомления запрещены в браузере.', 'error');
        return;
    }

    if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            showToast('Нужно разрешить уведомления для подписки.', 'warning');
            await syncPushButtons();
            return;
        }
    }

    try {
        const registration = await state.serviceWorkerReady;
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
            });
        }

        await fetch(`${API_BASE}/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription)
        });

        setMessage('Push-уведомления включены.');
        showToast('Подписка на уведомления успешно выполнена.', 'success');
    } catch (error) {
        console.error('Ошибка подписки на push:', error);
        showToast('Не удалось подключить уведомления.', 'error');
    }

    await syncPushButtons();
}

async function unsubscribeFromPush() {
    if (!state.serviceWorkerReady || !('PushManager' in window)) {
        return;
    }

    try {
        const registration = await state.serviceWorkerReady;
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            await fetch(`${API_BASE}/unsubscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: subscription.endpoint })
            });
            await subscription.unsubscribe();
        }

        setMessage('Push-уведомления отключены.');
        showToast('Подписка на уведомления удалена.', 'success');
    } catch (error) {
        console.error('Ошибка отписки от push:', error);
        showToast('Не удалось отключить уведомления.', 'error');
    }

    await syncPushButtons();
}

function renderNotes() {
    if (state.currentPage !== HOME_PAGE) {
        return;
    }

    const list = document.getElementById('notes-list');
    if (!list) {
        return;
    }

    const notes = readNotes();
    if (!notes.length) {
        list.innerHTML = '<li class="empty-state">Пока нет заметок. Добавьте первую запись или напоминание.</li>';
        return;
    }

    list.innerHTML = notes.map(note => {
        const reminderHtml = note.reminder
            ? `<span>Напоминание: ${formatDate(note.reminder)}</span>`
            : '<span>Без напоминания</span>';

        return `
            <li class="note-card">
                <header>
                    <span class="note-type ${note.reminder ? 'reminder' : ''}">
                        ${note.reminder ? 'Напоминание' : 'Заметка'}
                    </span>
                    <span class="muted">${formatDate(note.createdAt)}</span>
                </header>
                <p class="note-text">${escapeHtml(note.text)}</p>
                <div class="note-meta">
                    ${reminderHtml}
                </div>
            </li>
        `;
    }).join('');
}

function setActiveButton(activeId) {
    [homeBtn, aboutBtn].forEach(button => button.classList.remove('active'));
    document.getElementById(activeId).classList.add('active');
}

async function loadContent(page) {
    state.currentPage = page;

    try {
        const response = await fetch(`/content/${page}.html`, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        contentDiv.innerHTML = await response.text();

        if (page === HOME_PAGE) {
            initNotesPage();
        }
    } catch (error) {
        console.error('Ошибка загрузки страницы:', error);
        contentDiv.innerHTML = '<div class="panel"><p class="muted">Не удалось загрузить страницу. Если сеть отключена, перезагрузите приложение: Service Worker должен подставить кэшированную версию.</p></div>';
    }
}

function emitNote(note) {
    if (!state.socket) {
        return;
    }

    state.socket.emit('createNote', note);
}

function addLocalNote(note, options = {}) {
    upsertNote(note);
    renderNotes();

    if (options.notify) {
        showToast(options.notify, 'success');
    }
}

function initNotesPage() {
    const noteForm = document.getElementById('note-form');
    const noteInput = document.getElementById('note-input');
    const reminderForm = document.getElementById('reminder-form');
    const reminderText = document.getElementById('reminder-text');
    const reminderTime = document.getElementById('reminder-time');
    const clearNotesBtn = document.getElementById('clear-notes');

    if (reminderTime) {
        reminderTime.min = new Date(Date.now() + 60_000).toISOString().slice(0, 16);
    }

    noteForm?.addEventListener('submit', event => {
        event.preventDefault();
        const text = noteInput.value.trim();

        if (!text) {
            return;
        }

        const note = createNote(text);
        addLocalNote(note, { notify: 'Заметка сохранена.' });
        emitNote(note);
        noteInput.value = '';
        setMessage('Обычная заметка добавлена.');
    });

    reminderForm?.addEventListener('submit', event => {
        event.preventDefault();

        const text = reminderText.value.trim();
        const rawDate = reminderTime.value;

        if (!text || !rawDate) {
            return;
        }

        const reminderTimestamp = new Date(rawDate).getTime();
        if (Number.isNaN(reminderTimestamp) || reminderTimestamp <= Date.now()) {
            showToast('Дата напоминания должна быть в будущем.', 'warning');
            return;
        }

        const note = createNote(text, reminderTimestamp);
        addLocalNote(note, { notify: 'Напоминание запланировано.' });
        emitNote(note);

        reminderText.value = '';
        reminderTime.value = '';
        reminderTime.min = new Date(Date.now() + 60_000).toISOString().slice(0, 16);
        setMessage('Напоминание добавлено и отправлено на сервер.');
    });

    clearNotesBtn?.addEventListener('click', () => {
        clearNotes();
        renderNotes();
        setMessage('Список заметок очищен локально.');
        showToast('Локальные заметки очищены.', 'success');
    });

    renderNotes();
}

function connectSocket() {
    if (typeof io === 'undefined') {
        setMessage('Socket.IO клиент не загрузился, приложение работает локально.');
        return;
    }

    state.socket = io(API_BASE, {
        transports: ['websocket', 'polling']
    });

    state.socket.on('connect', () => {
        setMessage(`WebSocket подключён: ${state.socket.id}`);
    });

    state.socket.on('disconnect', () => {
        setMessage('WebSocket отключён. Локальная работа продолжается.');
    });

    state.socket.on('noteCreated', note => {
        const hasNote = readNotes().some(item => item.id === note.id);
        upsertNote(note);
        renderNotes();

        if (!hasNote) {
            showToast(`Получена заметка от другого клиента: ${note.text}`, 'success');
        }
    });
}

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        setServiceWorkerStatus('Не поддерживается');
        return;
    }

    try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        state.serviceWorkerReady = navigator.serviceWorker.ready;
        setServiceWorkerStatus('Зарегистрирован');
        setMessage(`Service Worker активен: ${registration.scope}`);
        await syncPushButtons();
    } catch (error) {
        console.error('Ошибка регистрации Service Worker:', error);
        setServiceWorkerStatus('Ошибка регистрации');
        setMessage('Service Worker не зарегистрирован.');
    }
}

async function handleAppLaunch() {
    if (state.installPromptEvent) {
        const promptEvent = state.installPromptEvent;
        state.installPromptEvent = null;
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;

        if (choice.outcome === 'accepted') {
            setMessage('Установка приложения подтверждена.');
            showToast('PWA устанавливается через браузер.', 'success');
        } else {
            setMessage('Установка приложения отменена.');
            showToast('Установка приложения отменена.', 'warning');
        }

        updateInstallButton();
        return;
    }

    window.open('/', '_blank', 'noopener,noreferrer');
}

homeBtn.addEventListener('click', () => {
    setActiveButton('home-btn');
    loadContent(HOME_PAGE);
});

aboutBtn.addEventListener('click', () => {
    setActiveButton('about-btn');
    loadContent(ABOUT_PAGE);
});

enablePushBtn.addEventListener('click', () => {
    subscribeToPush();
});

disablePushBtn.addEventListener('click', () => {
    unsubscribeFromPush();
});

appLaunchBtn?.addEventListener('click', () => {
    handleAppLaunch();
});

window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);
window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.installPromptEvent = event;
    updateInstallButton();
});

window.addEventListener('appinstalled', () => {
    state.installPromptEvent = null;
    updateInstallButton();
    setMessage('Приложение установлено. Его можно запускать как отдельное PWA-окно.');
    showToast('Приложение успешно установлено.', 'success');
});

document.addEventListener('DOMContentLoaded', async () => {
    updateStatus();
    updateInstallButton();
    connectSocket();
    await registerServiceWorker();
    await loadContent(HOME_PAGE);
});
