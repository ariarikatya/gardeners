import './globals.css';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import BuildVersionWatcher from '@/components/BuildVersionWatcher';
import ErrorBoundary from '@/components/ErrorBoundary';

export const metadata = {
  title: 'Анемон Агро',
  description: 'Система управления заказами садовников',
  manifest: '/manifest.json',
};

export const viewport = {
  themeColor: '#065f46',
};

const diagnosticScript = `
(function() {
  function showFallbackUI() {
    if (document.getElementById('self-diagnostic-fallback')) return;
    var fallback = document.createElement('div');
    fallback.id = 'self-diagnostic-fallback';
    fallback.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#f8fafc;display:flex;align-items:center;justify-content:center;padding:20px;font-family:sans-serif;box-sizing:border-box;';
    fallback.innerHTML = '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.08);">' +
      '<div style="font-size:40px;margin-bottom:12px;">⚠️</div>' +
      '<h2 style="font-size:18px;font-weight:700;color:#0f172a;margin:0 0 8px 0;">Страница не загрузилась</h2>' +
      '<p style="font-size:13px;color:#64748b;margin:0 0 16px 0;line-height:1.4;">Проверьте подключение к сети или обновите страницу.</p>' +
      '<button onclick="window.location.reload()" style="background:#059669;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;width:100%;">Обновить страницу</button>' +
    '</div>';
    var mount = function() {
      if (document.body && !document.getElementById('self-diagnostic-fallback')) {
        document.body.appendChild(fallback);
      }
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }

  window.addEventListener('error', function() {
    setTimeout(function() {
      if (!document.body || !document.body.innerText || !document.body.innerText.trim()) {
        showFallbackUI();
      }
    }, 500);
  });

  window.addEventListener('unhandledrejection', function() {
    setTimeout(function() {
      if (!document.body || !document.body.innerText || !document.body.innerText.trim()) {
        showFallbackUI();
      }
    }, 500);
  });

  window.addEventListener('load', function() {
    setTimeout(function() {
      if (!document.body || !document.body.innerText || !document.body.innerText.trim()) {
        showFallbackUI();
      }
    }, 4000);
  });
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <script dangerouslySetInnerHTML={{ __html: diagnosticScript }} />
      </head>
      <body>
        <ErrorBoundary>
          {children}
          <BuildVersionWatcher />
          <ServiceWorkerRegister />
        </ErrorBoundary>
      </body>
    </html>
  );
}
