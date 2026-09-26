import './globals.css';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';

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
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
