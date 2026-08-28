'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function AmoConnectPage() {
  const [siteOrigin, setSiteOrigin] = useState('https://gardeners-agro.netlify.app');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAmoStatus();

    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      setSiteOrigin(origin);

      const handleMessage = (event) => {
        if (event.data && (event.data.type === 'AMO_AUTH_SUCCESS' || event.data.type === 'amocrm_connected' || event.data.success)) {
          console.log('✅ Получено сообщение об успешном подключении amoCRM:', event.data);
          alert('✅ amoCRM подключена!');
          window.location.reload();
        }
      };

      window.addEventListener('message', handleMessage);

      const redirectUri = "https://gardeners-agro.netlify.app/api/amo/callback";
      const secretsUri = "https://gardeners-agro.netlify.app/api/amo/secrets";

      const scriptId = 'amocrm_oauth_script';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.className = 'amocrm_oauth';
        script.charset = 'utf-8';
        script.dataset.name = 'Садовники';
        script.dataset.description = 'Интеграция для сайта о заказах садовников';
        script.dataset.redirect_uri = redirectUri;
        script.dataset.secrets_uri = secretsUri;
        script.dataset.logo = `${origin}/logo.png`;
        script.dataset.scopes = 'crm,notifications';
        script.dataset.title = 'Подключить amoCRM';
        script.src = 'https://www.amocrm.ru/auth/button.min.js';
        document.body.appendChild(script);
      }

      return () => {
        window.removeEventListener('message', handleMessage);
      };
    }
  }, []);

  const checkAmoStatus = async () => {
    try {
      const res = await fetch('/api/admin/amo-status');
      const data = await res.json();
      if (data && data.connected) {
        setConnected(true);
      } else {
        setConnected(false);
      }
    } catch (e) {
      console.error(e);
      setConnected(false);
    } finally {
      setLoading(false);
    }
  };

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

        {/* Индикатор подключения */}
        <div className="mb-6">
          {loading ? (
            <div className="p-4 bg-slate-100 rounded-xl text-slate-500 text-center text-sm font-medium">
              Проверка статуса подключения...
            </div>
          ) : connected ? (
            <div className="p-4 bg-emerald-100 border border-emerald-300 rounded-xl text-emerald-900 font-bold text-base flex items-center justify-center gap-2">
              ✅ amoCRM ПОДКЛЮЧЕНА
            </div>
          ) : (
            <div className="p-4 bg-rose-100 border border-rose-300 rounded-xl text-rose-900 font-bold text-base flex items-center justify-center gap-2">
              ❌ НЕ ПОДКЛЮЧЕНА
            </div>
          )}
        </div>

        <div className="space-y-6">
          {connected ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center text-emerald-900 shadow-sm">
              <div className="text-4xl mb-2">✅</div>
              <h2 className="text-xl font-bold mb-1">amoCRM успешно подключена!</h2>
              <p className="text-sm text-emerald-800">
                Авторизационные токены получены и сохранены в базе данных. Статусы заказов и примечания будут автоматически синхронизироваться.
              </p>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-900">
              <h2 className="font-bold text-lg mb-2">Инструкция по автоподключению:</h2>
              <ol className="list-decimal list-inside space-y-1.5 text-sm">
                <li>Убедитесь, что вы авторизованы в вашей учетной записи amoCRM в этом же браузере.</li>
                <li>Нажмите синюю кнопку <strong>«Подключить amoCRM»</strong> ниже.</li>
                <li>В появившемся окне amoCRM выберите ваш аккаунт и подтвердите права доступа.</li>
                <li>Окно автоматически закроется, а токены сохранения будут занесены в базу данных.</li>
              </ol>
            </div>
          )}

          <div className="flex flex-col items-center justify-center py-8 bg-slate-50 border border-dashed border-slate-300 rounded-2xl min-h-[140px]">
            <div id="amocrm_button_container" className="my-2">
              <script
                className="amocrm_oauth"
                charset="utf-8"
                data-name="Садовники"
                data-description="Интеграция для сайта о заказах садовников"
                data-redirect_uri="https://gardeners-agro.netlify.app/api/amo/callback"
                data-secrets_uri="https://gardeners-agro.netlify.app/api/amo/secrets"
                data-logo={`${siteOrigin}/logo.png`}
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
