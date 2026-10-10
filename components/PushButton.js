'use client';

import { useState, useEffect } from 'react';
import { detectPwaEnv, subscribeToDisplayModeChange, CLIENT_VERSION } from '@/lib/pwa-env';
import { clientLog } from '@/lib/clientLog';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const IOS_NON_PWA_ALERT_MSG =
  'На iPhone уведомления доступны только для приложения, добавленного на домашний экран:\n\n' +
  '1) Откройте меню Поделиться (квадрат со стрелкой)\n' +
  '2) Выберите «На экран „Домой“»\n' +
  '3) Откройте Anemon Agro с иконки Домашнего экрана\n' +
  '4) Нажмите «Включить уведомления» здесь ещё раз\n\n' +
  '💡 Важно: если на Домашнем экране несколько иконок Анемон Агро — удалите все старые и откройте приложение по последней иконке; настройки уведомлений iOS хранятся отдельно для каждой иконки.';

async function performSilentReSubscribe(reg, oldEndpoint) {
  try {
    if (oldEndpoint) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: oldEndpoint }),
      }).catch(() => {});
    }

    const currentSub = await reg.pushManager.getSubscription().catch(() => null);
    if (currentSub) {
      await currentSub.unsubscribe().catch(() => {});
    }

    const vapidRes = await fetch('/api/push/vapid-public-key');
    const vapidData = await vapidRes.json().catch(() => ({}));
    if (!vapidData.key) return null;

    const newSub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidData.key),
    });

    const subRes = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: newSub.toJSON(), clientVersion: CLIENT_VERSION }),
    });

    const subData = await subRes.json().catch(() => ({}));
    if (subRes.ok && subData.ok && subData.hasUserId !== false) {
      clientLog('silent_resubscribe_success', { endpointPrefix: newSub.endpoint.slice(0, 40) });
      return newSub;
    }
  } catch (err) {
    clientLog('silent_resubscribe_failed', { error: err.message });
  }
  return null;
}

export default function PushButton({ className = '' }) {
  const [pushState, setPushState] = useState('loading'); // 'loading' | 'disabled' | 'enabled' | 'denied' | 'orphan' | 'unsupported'
  const [pushLoading, setPushLoading] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [showIosPushHint, setShowIosPushHint] = useState(false);
  const [isIosNonPwa, setIsIosNonPwa] = useState(false);
  const [envInfo, setEnvInfo] = useState(() => detectPwaEnv());
  const [showTools, setShowTools] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateEnvStatus = () => {
      const freshEnv = detectPwaEnv();
      setEnvInfo(freshEnv);
      const nonPwa = freshEnv.isIos && !freshEnv.isStandalone && !freshEnv.probableStandalone;
      setIsIosNonPwa(nonPwa);

      if (freshEnv.isStandalone || freshEnv.probableStandalone || freshEnv.notificationPermission === 'granted') {
        setShowIosPushHint(false);
      }
    };

    updateEnvStatus();

    const unsubscribeMq = subscribeToDisplayModeChange(() => {
      updateEnvStatus();
    });

    window.addEventListener('focus', updateEnvStatus);
    document.addEventListener('visibilitychange', updateEnvStatus);

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported');
      clientLog('mount', { state: 'unsupported' });
      return () => {
        unsubscribeMq();
        window.removeEventListener('focus', updateEnvStatus);
        document.removeEventListener('visibilitychange', updateEnvStatus);
      };
    }

    if (Notification.permission === 'denied') {
      setPushState('denied');
      clientLog('mount', { state: 'denied' });
    } else {
      navigator.serviceWorker.ready.then(async (reg) => {
        try {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            const subRes = await fetch('/api/push/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subscription: sub.toJSON(), clientVersion: CLIENT_VERSION }),
            }).catch(() => null);

            if (subRes && subRes.ok) {
              const subData = await subRes.json().catch(() => ({}));
              if (subData.ok && subData.hasUserId !== false) {
                setPushState('enabled');
                setShowIosPushHint(false);
                clientLog('mount', { state: 'enabled', synced: true, endpointPrefix: sub.endpoint.slice(0, 40) });
              } else if (Notification.permission === 'granted') {
                clientLog('mount_rebind_start');
                const reboundSub = await performSilentReSubscribe(reg, sub.endpoint);
                if (reboundSub) {
                  setPushState('enabled');
                  setShowIosPushHint(false);
                } else {
                  setPushState('orphan');
                }
              } else {
                setPushState('disabled');
              }
            } else {
              setPushState('enabled');
              setShowIosPushHint(false);
              clientLog('mount', { state: 'enabled', offline: true, endpointPrefix: sub.endpoint.slice(0, 40) });
            }
          } else {
            if (Notification.permission === 'granted') {
              const reboundSub = await performSilentReSubscribe(reg, null);
              if (reboundSub) {
                setPushState('enabled');
                setShowIosPushHint(false);
              } else {
                setPushState('orphan');
                clientLog('orphan_subscription_detected', {
                  notifPerm: Notification.permission,
                  displayMode: envInfo.displayMode,
                });
              }
            } else {
              setPushState('disabled');
              clientLog('mount', { state: 'disabled' });
            }
          }
        } catch (err) {
          console.error('[PushButton] Error checking push subscription:', err);
          setPushState('disabled');
          clientLog('mount', { state: 'disabled', checkError: err.message });
        }
      }).catch((swErr) => {
        setPushState('disabled');
        clientLog('mount', { state: 'disabled', swReadyError: swErr?.message });
      });
    }

    return () => {
      unsubscribeMq();
      window.removeEventListener('focus', updateEnvStatus);
      document.removeEventListener('visibilitychange', updateEnvStatus);
    };
  }, []);

  const handleClearAllCaches = async () => {
    clientLog('clear_caches_click');
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        const activeSw = reg?.active || reg?.waiting || reg?.installing;
        if (activeSw) {
          activeSw.postMessage({ type: 'CLEAR_ALL_CACHES' });
          clientLog('clear_caches_sent');
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      alert('✅ Кэш приложения сброшен. Страница будет обновлена.');
      window.location.reload();
    } catch (e) {
      console.error('Failed to clear cache:', e);
      alert('Ошибка при сбросе кэша: ' + e.message);
    }
  };

  const handleSendTestPush = async () => {
    if (testingPush) return;
    setTestingPush(true);
    clientLog('send_test_push_click');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      let res = await fetch('/api/push/test', {
        method: 'POST',
        signal: controller.signal,
      });
      let data = await res.json().catch(() => ({}));

      if ((!res.ok || !data.ok) && (data.expired || data.statusCode === 404 || data.statusCode === 410)) {
        if (Notification.permission === 'granted') {
          const reg = await navigator.serviceWorker.ready.catch(() => null);
          if (reg) {
            const currentSub = await reg.pushManager.getSubscription().catch(() => null);
            const newSub = await performSilentReSubscribe(reg, currentSub?.endpoint);
            if (newSub) {
              setPushState('enabled');
              res = await fetch('/api/push/test', { method: 'POST', signal: controller.signal });
              data = await res.json().catch(() => ({}));
            }
          }
        }
      }

      clearTimeout(timeoutId);

      if (res.ok && data.ok) {
        alert(`✅ доставлено (${data.statusCode || 201})`);
      } else if (data.expired || data.statusCode === 404 || data.statusCode === 410) {
        setPushState(Notification.permission === 'denied' ? 'denied' : 'orphan');
        if (Notification.permission === 'denied') {
          alert('Уведомления заблокированы в настройках браузера. Разрешите их в настройках сайта.');
        } else {
          alert('⚠️ подписка протухла — разрешите уведомления заново');
        }
      } else {
        alert(`❌ ошибка ${data.statusCode || res.status || data.error || 'неизвестно'}`);
      }
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        alert('❌ Ошибка: таймаут ожидания ответа (15с)');
      } else {
        alert(`❌ Ошибка отправки теста: ${e.message}`);
      }
    } finally {
      setTestingPush(false);
    }
  };

  const handleReSubscribe = async () => {
    clientLog('re_subscribe_click');
    try {
      const reg = await navigator.serviceWorker.ready;
      const oldSub = await reg.pushManager.getSubscription();
      if (oldSub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: oldSub.endpoint }),
        }).catch(() => {});
        await oldSub.unsubscribe().catch(() => {});
        clientLog('re_subscribe_unsubscribed_old', { oldEndpointPrefix: oldSub.endpoint.slice(0, 40) });
      }
    } catch (e) {
      console.warn('Re-subscribe unsubscribe old error:', e);
    }
    setPushState('disabled');
    await handleTogglePush(true);
  };

  const handleTogglePush = async (forceReSubscribe = false) => {
    if (pushLoading) return;

    const freshEnv = detectPwaEnv();
    setEnvInfo(freshEnv);
    clientLog('toggle_click', { pushState, forceReSubscribe, freshEnv });

    sessionStorage.setItem('push_flow_active', '1');

    // Instruction gate condition: iOS non-PWA and not probableStandalone
    if (freshEnv.isIos && !freshEnv.isStandalone && !freshEnv.probableStandalone && Notification.permission !== 'granted') {
      clientLog('ios_gate_shown', {
        reason: 'click_recheck_not_standalone',
        evidence: {
          displayMode: freshEnv.displayMode,
          probableStandalone: freshEnv.probableStandalone,
          notificationApiAvailable: freshEnv.notificationApiAvailable,
          standaloneNavigator: typeof navigator !== 'undefined' ? navigator.standalone : undefined,
        },
      });
      setShowIosPushHint(true);
      alert(IOS_NON_PWA_ALERT_MSG);
      sessionStorage.removeItem('push_flow_active');
      return;
    } else {
      setIsIosNonPwa(false);
    }

    setPushLoading(true);

    try {
      if (pushState === 'enabled' && !forceReSubscribe) {
        clientLog('unsubscribe_start');
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          }).catch(() => {});
          await sub.unsubscribe().catch(() => {});
        }
        setPushState('disabled');
        clientLog('unsubscribe_success');
      } else {
        const permBefore = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
        clientLog('permission_before', { permBefore });

        const permission = await Notification.requestPermission();
        clientLog('permission_result', { permBefore, permissionResult: permission });

        if (permission === 'denied') {
          setPushState('denied');
          alert('Уведомления заблокированы в настройках браузера. Разрешите их в настройках сайта.');
          setPushLoading(false);
          return;
        }

        if (permission !== 'granted') {
          setPushLoading(false);
          return;
        }

        const vapidRes = await fetch('/api/push/vapid-public-key');
        const vapidData = await vapidRes.json();
        if (!vapidData.key) {
          clientLog('vapid_missing');
          alert('VAPID публичный ключ не настроен на сервере.');
          setPushLoading(false);
          return;
        }

        const reg = await navigator.serviceWorker.ready;
        clientLog('sw_ready', {
          scope: reg?.scope,
          activeScript: reg?.active?.scriptURL,
          hasController: Boolean(navigator.serviceWorker.controller),
        });

        let sub = null;
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidData.key),
          });
        } catch (subErr) {
          clientLog('subscribe_error', { name: subErr.name, message: subErr.message, stack: subErr.stack });
          const recheckEnv = detectPwaEnv();

          if (subErr.name === 'NotAllowedError') {
            if (recheckEnv.isIos && !recheckEnv.isStandalone && !recheckEnv.probableStandalone && Notification.permission !== 'granted') {
              setShowIosPushHint(true);
              alert(IOS_NON_PWA_ALERT_MSG);
            } else {
              alert('iOS отклонила подписку на push-уведомления. Пожалуйста, проверьте в Настройки iPhone -> Уведомления -> Anemon Agro, что уведомления разрешены.');
            }
          } else {
            alert(`Ошибка при настройке уведомлений: ${subErr.message || subErr.name || 'Ошибка push-сервиса'}.`);
          }

          setPushLoading(false);
          return;
        }

        const subRes = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON(), clientVersion: CLIENT_VERSION }),
        });

        const subData = await subRes.json().catch(() => ({}));

        if (!subRes.ok || subData.ok === false) {
          clientLog('server_subscribe_fail', { status: subRes.status, subData });
          alert('Ошибка при сохранении подписки на сервере: ' + (subData.error || 'Неизвестная ошибка'));
          setPushLoading(false);
          return;
        }

        setPushState('enabled');
        setShowIosPushHint(false);

        if (subData.hasUserId === false) {
          alert('⚠️ Подписка сохранена, но не привязана к аккаунту (userId отсутствует). Перезайдите в аккаунт.');
        } else {
          const testRes = await fetch('/api/push/test', { method: 'POST' });
          const testData = await testRes.json().catch(() => ({}));

          if (testRes.ok && testData.ok) {
            alert('✅ Подписка включена! Тестовое уведомление отправлено.');
          } else {
            alert('⚠️ Подписка включена, но тестовое уведомление вернуть не удалось: ' + (testData.error || 'Неизвестная ошибка'));
          }
        }
      }
    } catch (err) {
      clientLog('toggle_push_uncaught_error', { message: err.message, stack: err.stack });
      console.error('[PushButton] Failed to toggle push notifications:', err);
      alert('Ошибка при настройке уведомлений: ' + err.message);
    } finally {
      sessionStorage.removeItem('push_flow_active');
      setPushLoading(false);
    }
  };

  if (pushState === 'unsupported') return null;

  const statusSelfTestStr = `${CLIENT_VERSION} | mode: ${envInfo.displayMode} | perm: ${envInfo.notificationPermission} | sub: ${pushState === 'enabled' ? 'yes' : pushState === 'orphan' ? 'lost' : 'no'}`;

  return (
    <div className="inline-flex flex-col items-start gap-1">
      {showIosPushHint && (
        <div className="fixed top-2 left-2 right-2 z-50 bg-emerald-50 border border-emerald-300 text-slate-900 px-3.5 py-2.5 rounded-xl text-xs flex justify-between items-start shadow-xl">
          <div className="leading-relaxed">
            <div className="font-bold mb-1">📲 Настройка уведомлений на iPhone:</div>
            <ol className="list-decimal list-inside space-y-0.5 text-[11px]">
              <li>Откройте меню Поделиться (квадрат со стрелкой)</li>
              <li>Выберите «На экран „Домой“»</li>
              <li>Откройте Anemon Agro с иконки Домашнего экрана</li>
              <li>Нажмите «Включить уведомления» здесь ещё раз</li>
            </ol>
            <div className="mt-1.5 text-[10px] text-emerald-800 font-medium">
              💡 Если на Домашнем экране несколько иконок — удалите все старые и откройте с последней.
            </div>
          </div>
          <button onClick={() => setShowIosPushHint(false)} className="text-slate-900 font-bold ml-2 text-sm p-1">✕</button>
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {pushState === 'enabled' ? (
          <>
            <button
              type="button"
              onClick={() => handleTogglePush(false)}
              disabled={pushLoading}
              className={className || "flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg px-2.5 py-1 transition-all whitespace-nowrap text-xs"}
              title={`Нажмите, чтобы отключить push-уведомления (${statusSelfTestStr})`}
            >
              🔔 {pushLoading ? '...' : 'Отключить уведомления'}
            </button>
            <button
              type="button"
              onClick={handleSendTestPush}
              disabled={testingPush}
              className="flex items-center gap-1 bg-sky-700 hover:bg-sky-600 text-white font-medium rounded-lg px-2 py-1 transition-all whitespace-nowrap text-xs"
              title="Отправить тестовое push-уведомление на это устройство"
            >
              🧪 {testingPush ? '...' : 'Отправить тест'}
            </button>
          </>
        ) : pushState === 'orphan' ? (
          <button
            type="button"
            onClick={handleReSubscribe}
            disabled={pushLoading}
            className={className || "flex items-center gap-1.5 bg-amber-700 hover:bg-amber-600 text-white font-medium rounded-lg px-2.5 py-1 transition-all whitespace-nowrap text-xs"}
            title={`Подписка на устройстве не найдена, разрешите заново (${statusSelfTestStr})`}
          >
            ⚠️ {pushLoading ? '...' : 'Восстановить подписку'}
          </button>
        ) : pushState === 'denied' ? (
          <button
            type="button"
            onClick={() => alert('Уведомления заблокированы браузером. Разрешите их в настройках сайта.')}
            className={className || "flex items-center gap-1.5 bg-rose-700 hover:bg-rose-600 text-white font-medium rounded-lg px-2.5 py-1 transition-all whitespace-nowrap text-xs"}
            title={`Разрешите уведомления в настройках сайта (${statusSelfTestStr})`}
          >
            🔕 Разрешите уведомления
          </button>
        ) : (
          <button
            type="button"
            onClick={() => handleTogglePush(false)}
            disabled={pushLoading || pushState === 'loading'}
            className={className || "flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg px-2.5 py-1 transition-all whitespace-nowrap text-xs"}
            title={isIosNonPwa ? `Добавьте приложение на экран Домой на iPhone (${statusSelfTestStr})` : statusSelfTestStr}
          >
            🔔 {pushLoading ? '...' : 'Включить уведомления'}
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
          className="text-[10px] text-slate-400 hover:text-slate-200 px-1 py-0.5 rounded border border-slate-700/50"
          title="Сведения о системе и инструменты"
        >
          ℹ️
        </button>
      </div>

      {showTools && (
        <div className="bg-slate-900 text-slate-200 border border-slate-700 p-2 rounded-lg text-[10px] space-y-1 z-40 max-w-xs shadow-lg font-mono">
          <div className="text-[9px] text-slate-400 border-b border-slate-800 pb-1">
            {statusSelfTestStr}
          </div>
          <div className="flex gap-2 pt-1">
            {(pushState === 'enabled' || pushState === 'orphan') && (
              <button
                type="button"
                onClick={handleReSubscribe}
                disabled={pushLoading}
                className="bg-emerald-800 hover:bg-emerald-700 text-white px-2 py-0.5 rounded text-[10px]"
              >
                🔄 Перепроверить
              </button>
            )}
            <button
              type="button"
              onClick={handleClearAllCaches}
              className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded text-[10px]"
            >
              🗑️ Сбросить кэш
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
