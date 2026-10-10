import './globals.css';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import BuildVersionWatcher from '@/components/BuildVersionWatcher';

export const metadata = {
  title: 'Анемон Агро',
  description: 'Система управления заказами садовников',
  manifest: '/manifest.json',
};

export const viewport = {
  themeColor: '#065f46',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function showFatalError(msg) {
                  if (document.getElementById('fatal-error-fallback')) return;
                  var div = document.createElement('div');
                  div.id = 'fatal-error-fallback';
                  div.style.cssText = 'position:fixed;inset:0;background:#f8fafc;display:flex;align-items:center;justify-content:center;padding:20px;font-family:sans-serif;z-index:999999;';
                  div.innerHTML = '<div style="background:white;padding:28px 20px;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-width:380px;width:100%;text-align:center;border:1px solid #e2e8f0;">' +
                    '<h2 style="color:#065f46;margin:0 0 8px;font-size:18px;">📡 Ошибка загрузки</h2>' +
                    '<p style="color:#64748b;font-size:13px;margin:0 0 16px;">Сбой загрузки страницы (' + (msg || 'Сеть недоступна') + '). Попробуйте обновить страницу.</p>' +
                    '<button onclick="window.location.reload()" style="background:#059669;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;font-size:14px;">Обновить страницу</button>' +
                    '</div>';
                  if (document.body) document.body.appendChild(div);
                }
                window.addEventListener('error', function(e) {
                  if (e && e.message && (e.message.indexOf('Hydration') !== -1 || e.message.indexOf('Minified React error') !== -1)) {
                    showFatalError('сбой гидратации');
                  }
                });
                window.addEventListener('unhandledrejection', function(e) {
                  if (document.body && (!document.body.children || document.body.children.length === 0 || document.body.innerText.trim() === '')) {
                    showFatalError('ошибка сети');
                  }
                });
              })();
            `
          }}
        />
      </head>
      <body>
        {children}
        <BuildVersionWatcher />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
