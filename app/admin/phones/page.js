'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AdminPhonesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [users, setUsers] = useState([]);
  const [phoneInputs, setPhoneInputs] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [messages, setMessages] = useState({}); // userId => { text, isWarning }

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/phones');
      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка загрузки данных');
      }
      setUsers(data.users || []);
      const inputs = {};
      (data.users || []).forEach(u => {
        inputs[u.id] = u.phone || '';
      });
      setPhoneInputs(inputs);
    } catch (e) {
      console.error(e);
      setForbidden(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePhone = async (userId) => {
    const newPhone = phoneInputs[userId];
    if (!newPhone) {
      alert('Укажите номер телефона');
      return;
    }

    setSavingId(userId);
    setMessages(prev => ({ ...prev, [userId]: null }));

    try {
      const res = await fetch('/api/admin/phones', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, phone: newPhone }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Не удалось обновить номер');
        return;
      }

      if (data.hadVkReset) {
        setMessages(prev => ({
          ...prev,
          [userId]: {
            text: 'Номер изменен. Пользователю нужно заново написать новый номер в сообщения группы VK для привязки.',
            isWarning: true,
          },
        }));
      } else {
        setMessages(prev => ({
          ...prev,
          [userId]: {
            text: 'После смены номера пользователю нужно написать новый номер в сообщения группы VK https://vk.com/club239199622',
            isWarning: false,
          },
        }));
      }

      await fetchUsers();
    } catch (err) {
      alert('Ошибка соединения с сервером');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">
        Загрузка...
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex flex-col items-center justify-center">
        <div className="bg-white p-6 rounded-2xl shadow max-w-md text-center border border-rose-200">
          <div className="text-4xl mb-3">⛔</div>
          <h1 className="text-xl font-bold text-rose-700 mb-2">Доступ запрещен</h1>
          <p className="text-sm text-slate-600 mb-4">
            Эта страница доступна ТОЛЬКО руководителю (LEADER).
          </p>
          <button
            onClick={() => router.push('/admin')}
            className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-xl hover:bg-slate-700"
          >
            Вернуться в админ-панель
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            📱 Управление номерами диспетчеров и руководителей
          </h1>
          <Link
            href="/admin"
            className="text-sm px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-all"
          >
            ← В Панель Администратора
          </Link>
        </div>

        <div className="space-y-4">
          {users.map((u) => (
            <div key={u.id} className="p-4 border border-slate-200 rounded-xl bg-slate-50/50">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-bold text-slate-900 text-base mr-2">{u.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${u.role === 'LEADER' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {u.role === 'LEADER' ? 'Руководитель' : 'Диспетчер'}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {u.vkId ? (
                    <span className="text-emerald-700 font-medium">✓ VK привязан ({u.vkId})</span>
                  ) : (
                    <span className="text-slate-400">VK не привязан</span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 items-center mt-3">
                <input
                  type="text"
                  value={phoneInputs[u.id] || ''}
                  onChange={(e) => setPhoneInputs({ ...phoneInputs, [u.id]: e.target.value })}
                  placeholder="79001234567"
                  className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
                />
                <button
                  disabled={savingId === u.id}
                  onClick={() => handleSavePhone(u.id)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-xl transition-all disabled:opacity-50"
                >
                  {savingId === u.id ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>

              {messages[u.id] && (
                <div className={`mt-3 p-3 rounded-xl text-xs font-medium ${messages[u.id].isWarning ? 'bg-amber-50 text-amber-900 border border-amber-200' : 'bg-sky-50 text-sky-900 border border-sky-200'}`}>
                  {messages[u.id].text}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
