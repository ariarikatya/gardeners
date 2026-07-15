import './globals.css';

export const metadata = {
  title: 'Анемон Агро',
  description: 'Система управления заказами садовников',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
