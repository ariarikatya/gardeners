'use client';
import { useEffect } from 'react';
import Link from 'next/link';

export default function AmoConnectPage() {
  useEffect(() => {
    const scriptId = 'amocrm_oauth_script';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.className = 'amocrm_oauth';
      script.charset = 'utf-8';
      script.dataset.name = 'Садовники';
      script.dataset.description = 'Интеграция для сайта о заказах садовников';
      script.dataset.redirect_uri = 'https://gardeners-agro.netlify.app';
      script.dataset.secrets_uri = 'https://gardeners-agro.netlify.app/api/amo/secrets';
      script.dataset.logo = 'https://gardeners-agro.netlify.app/logo.png';
      script.dataset.scopes = 'crm,notifications';
      script.dataset.title = 'Подключить amoCRM';
      script.src = 'https://www.amocrm.ru/auth/button.min.js';
      document.body.appendChild(script);
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            🔌 Подключение amoCRM
          </h1>
          <Link
            href="/admin"
            className="text-sm px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-all"
          >
            ← В Панель Администратора
          </Link>
        </div>

        <div className="space-y-6">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-900">
            <h2 className="font-bold text-lg mb-2">Инструкция по автоподключению:</h2>
            <ol className="list-decimal list-inside space-y-1.5 text-sm">
              <li>Убедитесь, что вы авторизованы в вашей учетной записи amoCRM в этом же браузере.</li>
              <li>Нажмите синюю кнопку <strong>«Подключить amoCRM»</strong> ниже.</li>
              <li>В появившемся окне amoCRM выберите ваш аккаунт и подтвердите права доступа.</li>
              <li>Токены авторизации будут автоматически получены и сохранены в базе данных системы.</li>
            </ol>
          </div>

          <div className="flex flex-col items-center justify-center py-8 bg-slate-50 border border-dashed border-slate-300 rounded-2xl min-h-[140px]">
            <div id="amocrm_button_container" className="my-2">
              <script
                className="amocrm_oauth"
                charset="utf-8"
                data-name="Садовники"
                data-description="Интеграция для сайта о заказах садовников"
                data-redirect_uri="https://gardeners-agro.netlify.app"
                data-secrets_uri="https://gardeners-agro.netlify.app/api/amo/secrets"
                data-logo="https://gardeners-agro.netlify.app/logo.png"
                data-scopes="crm,notifications"
                data-title="Подключить amoCRM"
                src="https://www.amocrm.ru/auth/button.min.js"
              ></script>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
