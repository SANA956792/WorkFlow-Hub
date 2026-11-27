self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function sanitizeRelativeUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '/';
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/';
  }
  return trimmed;
}

self.addEventListener('push', (event) => {
  let payload = {
    title: 'WORK ORGANIZER',
    body: 'You have a new workspace update.',
    url: '/?section=tasks',
    section: 'tasks',
    taskId: null,
    tag: undefined,
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          title:
            typeof parsed.title === 'string' && parsed.title.trim()
              ? parsed.title.trim()
              : 'WORK ORGANIZER',
          body:
            typeof parsed.body === 'string' && parsed.body.trim()
              ? parsed.body.trim()
              : 'You have a new workspace update.',
          url: sanitizeRelativeUrl(parsed.url || '/?section=tasks'),
          section: typeof parsed.section === 'string' ? parsed.section : 'tasks',
          taskId: typeof parsed.taskId === 'string' ? parsed.taskId : null,
          tag: typeof parsed.tag === 'string' && parsed.tag ? parsed.tag : undefined,
        };
      }
    } catch {
      try {
        const text = event.data.text();
        if (text && text.trim()) {
          payload.body = text.trim();
        }
      } catch {
        // Use defaults
      }
    }
  }

  const options = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag,
    renotify: Boolean(payload.tag),
    data: {
      url: payload.url,
      section: payload.section,
      taskId: payload.taskId,
    },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = (event.notification && event.notification.data) || {};
  const relativePath = sanitizeRelativeUrl(data.url || '/?section=tasks');
  const targetUrl = new URL(relativePath, self.location.origin).toString();
  const section = typeof data.section === 'string' ? data.section : 'tasks';
  const taskId = typeof data.taskId === 'string' ? data.taskId : null;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windowClients) => {
        for (const client of windowClients) {
          if (client.url && client.url.startsWith(self.location.origin)) {
            if ('focus' in client) {
              await client.focus().catch(() => {});
            }
            client.postMessage({
              type: 'WORKFLOW_PUSH_NAVIGATE',
              section,
              taskId,
              url: relativePath,
            });
            return;
          }
        }
        if (self.clients.openWindow) {
          await self.clients.openWindow(targetUrl);
        }
      })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription;
        const appServerKey =
          oldSub && oldSub.options && oldSub.options.applicationServerKey;
        if (!appServerKey) return;

        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey,
        });

        await fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify(newSub.toJSON()),
        });
      } catch {
        // Subscription will be refreshed next time the app opens
      }
    })()
  );
});
