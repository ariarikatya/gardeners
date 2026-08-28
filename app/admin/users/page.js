'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AdminUsersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [userInputs, setUserInputs] = useState({}); // userId => { name, phone }
  const [savingId, setSavingId] = useState(null);
  const [warnings, setWarnings] = useState({}); // userId => warning text

  // Форма добавления нового диспетчера
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');

  useEffect(() => {
    checkRoleAndFetchUsers();
  }, []);

  const checkRoleAndFetchUsers = async () => {
    try {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) {
        router.push('/admin');
        return;
      }
      const meData = await meRes.json();
      if (!meData.user || meData.user.role !== 'LEADER') {
        router.push('/admin');
        return;
      }

      const res = await fetch('/api/admin/users');
      if (res.status === 403) {
        router.push('/admin');
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
      router.push('/admin');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.status === 403) {
        router.push('/admin');
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setUsers(data.users || []);
        const inputs = {};
        (data.users || []).forEach(u => {
          inputs[u.id] = { name: u.name || '', phone: u.phone || '' };
        });
        setUserInputs(inputs);
      }
    } catch (e) {
      console.error(e);
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
    if (!input || !input.phone) {
      alert('Заполните номер телефона');
      return;
    }

    const cleanPhone = String(input.phone).replace(/\D/g, '');
    const oldCleanPhone = String(user.phone).replace(/\D/g, '');
    const phoneChanged = oldCleanPhone !== cleanPhone;

    setSavingId(user.id);
    setWarnings(prev => ({ ...prev, [user.id]: null }));

    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, name: input.name || user.name, phone: input.phone }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Не удалось обновить пользователя');
        return;
      }

      if (phoneChanged || data.vkIdReset) {
        setWarnings(prev => ({
          ...prev,
          [user.id]: 'Привязка VK сброшена. Пользователю нужно написать новый номер в сообщения группы https://vk.com/club239199622',
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
    if (!newName || !newPhone || !newPassword) {
      alert('Укажите имя, телефон и пароль для нового диспетчера');
      return;
    }

    setCreating(true);
    setCreateMsg('');

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, phone: newPhone, password: newPassword })
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Ошибка при создании диспетчера');
        return;
      }

      setCreateMsg(`✅ Диспетчер ${data.user.name} успешно создан!`);
      setNewName('');
      setNewPhone('');
      setNewPassword('');
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

        {/* Секция: Добавить диспетчера */}
        <div className="mb-8 p-5 bg-emerald-50/60 border border-emerald-200 rounded-2xl">
          <h2 className="text-lg font-bold text-emerald-900 mb-3 flex items-center gap-2">
            ➕ Добавить диспетчера
          </h2>
          <form onSubmit={handleCreateDispatcher} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Имя</label>
              <input
                type="text"
                required
                placeholder="Имя диспетчера"
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
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Пароль</label>
              <input
                type="password"
                required
                placeholder="Пароль"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={creating}
                className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50"
              >
                {creating ? 'Добавление...' : 'Добавить диспетчера'}
              </button>
            </div>
          </form>
          {createMsg && (
            <div className="mt-3 text-xs font-bold text-emerald-800 bg-emerald-100 p-2.5 rounded-xl border border-emerald-300">
              {createMsg}
            </div>
          )}
        </div>

        {/* Секция: Список пользователей */}
        <h2 className="text-lg font-bold text-slate-900 mb-4">
          Список пользователей
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="p-3">Имя</th>
                <th className="p-3">Телефон</th>
                <th className="p-3">Роль</th>
                <th className="p-3">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const input = userInputs[u.id] || { name: u.name, phone: u.phone };
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-800">
                      {u.name}
                    </td>
                    <td className="p-3 font-medium">
                      <input
                        type="text"
                        value={input.phone}
                        onChange={(e) => handleInputChange(u.id, 'phone', e.target.value)}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white w-full max-w-[170px]"
                      />
                      {warnings[u.id] && (
                        <div className="mt-1 text-xs text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200">
                          {warnings[u.id]}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${u.role === 'LEADER' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>
                        {u.role === 'LEADER' ? 'LEADER' : 'ADMIN'}
                      </span>
                    </td>
                    <td className="p-3">
                      <button
                        disabled={savingId === u.id}
                        onClick={() => handleSaveUser(u)}
                        className="py-1 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg transition-all disabled:opacity-50 whitespace-nowrap"
                      >
                        {savingId === u.id ? 'Сохранение...' : 'Сохранить'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
