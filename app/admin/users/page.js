'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AdminUsersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [users, setUsers] = useState([]);
  const [userInputs, setUserInputs] = useState({}); // userId => { name, phone }
  const [savingId, setSavingId] = useState(null);
  const [messages, setMessages] = useState({}); // userId => { text, isWarning }

  // Форма добавления нового диспетчера
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [createSuccessMsg, setCreateSuccessMsg] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка загрузки пользователей');
      }
      setUsers(data.users || []);
      const inputs = {};
      (data.users || []).forEach(u => {
        inputs[u.id] = { name: u.name || '', phone: u.phone || '' };
      });
      setUserInputs(inputs);
    } catch (e) {
      console.error(e);
      setForbidden(true);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (userId, field, value) => {
    setUserInputs(prev => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        [field]: value
      }
    }));
  };

  const handleSaveUser = async (user) => {
    const input = userInputs[user.id];
    if (!input || !input.name || !input.phone) {
      alert('Заполните имя и номер телефона');
      return;
    }

    const cleanPhone = String(input.phone).replace(/\D/g, '');
    const oldCleanPhone = String(user.phone).replace(/\D/g, '');
    const willResetVk = oldCleanPhone !== cleanPhone && Boolean(user.vkId);

    if (willResetVk) {
      const confirmMsg = 'ВНИМАНИЕ: При смене номера привязка к VK будет сброшена. Пользователю нужно будет заново написать новый номер в сообщения группы https://vk.com/club239199622\n\nПродолжить?';
      if (!confirm(confirmMsg)) return;
    }

    setSavingId(user.id);
    setMessages(prev => ({ ...prev, [user.id]: null }));

    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, name: input.name, phone: input.phone }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Не удалось обновить пользователя');
        return;
      }

      if (data.hadVkReset || data.vkIdReset) {
        setMessages(prev => ({
          ...prev,
          [user.id]: {
            text: 'Номер изменен. Привязка VK сброшена. Пользователю нужно написать новый номер в сообщения группы https://vk.com/club239199622',
            isWarning: true,
          },
        }));
      } else {
        setMessages(prev => ({
          ...prev,
          [user.id]: {
            text: 'Данные пользователя успешно сохранены!',
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

  const handleCreateDispatcher = async (e) => {
    e.preventDefault();
    if (!newName || !newPhone) {
      alert('Укажите имя и телефон для нового диспетчера');
      return;
    }

    setCreating(true);
    setCreateSuccessMsg('');

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, phone: newPhone })
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Ошибка при создании диспетчера');
        return;
      }

      setCreateSuccessMsg(`✅ Диспетчер ${data.user.name} (тел: ${data.user.phone}) успешно создан!`);
      setNewName('');
      setNewPhone('');
      await fetchUsers();
    } catch (err) {
      alert('Ошибка при вызове сервера');
    } finally {
      setCreating(false);
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
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            👥 Управление пользователями
          </h1>
          <Link
            href="/admin"
            className="text-sm px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-all"
          >
            ← В Панель Администратора
          </Link>
        </div>

        {/* Секция: Создать нового диспетчера */}
        <div className="mb-8 p-5 bg-emerald-50/60 border border-emerald-200 rounded-2xl">
          <h2 className="text-lg font-bold text-emerald-900 mb-3 flex items-center gap-2">
            ➕ Добавить нового диспетчера
          </h2>
          <form onSubmit={handleCreateDispatcher} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Имя диспетчера</label>
              <input
                type="text"
                required
                placeholder="Иван Диспетчер"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Телефон</label>
              <input
                type="text"
                required
                placeholder="79085535311"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={creating}
                className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50"
              >
                {creating ? 'Создание...' : 'Создать диспетчера'}
              </button>
            </div>
          </form>
          {createSuccessMsg && (
            <div className="mt-3 text-xs font-bold text-emerald-800 bg-emerald-100 p-2.5 rounded-xl border border-emerald-300">
              {createSuccessMsg}
            </div>
          )}
        </div>

        {/* Секция: Список пользователей */}
        <h2 className="text-lg font-bold text-slate-900 mb-4">
          Список пользователей (Диспетчеры и Руководители)
        </h2>

        <div className="space-y-4">
          {users.map((u) => {
            const input = userInputs[u.id] || { name: u.name, phone: u.phone };
            return (
              <div key={u.id} className="p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${u.role === 'LEADER' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>
                      {u.role === 'LEADER' ? 'Руководитель' : 'Диспетчер'}
                    </span>
                  </div>
                  <div>
                    {u.vkId ? (
                      <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                        ✓ Привязан к VK ({u.vkId})
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200">
                        ✗ Не привязан
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-500 mb-0.5 font-medium">Имя</label>
                    <input
                      type="text"
                      value={input.name}
                      onChange={(e) => handleInputChange(u.id, 'name', e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-sm bg-white font-medium"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-500 mb-0.5 font-medium">Телефон</label>
                    <input
                      type="text"
                      value={input.phone}
                      onChange={(e) => handleInputChange(u.id, 'phone', e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-sm bg-white font-medium"
                    />
                  </div>
                  <div className="flex items-end sm:pt-4">
                    <button
                      disabled={savingId === u.id}
                      onClick={() => handleSaveUser(u)}
                      className="w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-xl transition-all disabled:opacity-50"
                    >
                      {savingId === u.id ? 'Сохранение...' : 'Сохранить'}
                    </button>
                  </div>
                </div>

                {messages[u.id] && (
                  <div className={`mt-3 p-3 rounded-xl text-xs font-medium ${messages[u.id].isWarning ? 'bg-amber-50 text-amber-900 border border-amber-200' : 'bg-emerald-50 text-emerald-900 border border-emerald-200'}`}>
                    {messages[u.id].text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
