'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminUsersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [users, setUsers] = useState([]);
  const [gardeners, setGardeners] = useState([]);
  const [services, setServices] = useState([]);
  const [userInputs, setUserInputs] = useState({}); // userId => { name, phone, vkId }
  const [editingGardener, setEditingGardener] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [warnings, setWarnings] = useState({}); // userId => warning text

  // Форма добавления нового диспетчера
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
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
      setCurrentUserRole(meData.user.role);

      await fetchUsersAndGardeners();
    } catch (e) {
      console.error(e);
      router.push('/admin');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsersAndGardeners = async () => {
    try {
      const [resUsers, resGardeners, resServices] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/gardeners'),
        fetch('/api/admin/services'),
      ]);

      if (resUsers.status === 403) {
        router.push('/admin');
        return;
      }

      const dataUsers = await resUsers.json();
      const dataGardeners = await resGardeners.json();
      const dataServices = await resServices.json();

      setUsers(dataUsers.users || []);
      setGardeners(dataGardeners.gardeners || []);
      setServices(dataServices.services || []);

      const inputs = {};
      (dataUsers.users || []).forEach(u => {
        inputs[u.id] = { name: u.name || '', phone: u.phone || '', vkId: u.vkId || '' };
      });
      setUserInputs(inputs);
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
        body: JSON.stringify({
          userId: user.id,
          name: input.name || user.name,
          phone: input.phone,
          vkId: input.vkId ? String(input.vkId).trim() : null
        }),
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

      await fetchUsersAndGardeners();
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
    setCreateMsg('');

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

      setCreateMsg(`✅ Диспетчер ${data.user.name} успешно создан!`);
      setNewName('');
      setNewPhone('');
      await fetchUsersAndGardeners();
    } catch (err) {
      alert('Ошибка при вызове сервера');
    } finally {
      setCreating(false);
    }
  };

  const openEditGardener = (g) => {
    setEditingGardener({
      id: g.id,
      name: g.name,
      phone: g.phone,
      serviceIds: (g.services || []).map(s => s.id),
      vkId: g.vkId || '',
      photoUrl: g.videoUrl || g.photoUrl || ''
    });
  };

  const toggleEditGardenerService = (serviceId) => {
    setEditingGardener(prev => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(serviceId)
        ? prev.serviceIds.filter(id => id !== serviceId)
        : [...prev.serviceIds, serviceId]
    }));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const base64 = evt.target.result;
      try {
        const res = await fetch('/api/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 }),
        });
        const data = await res.json();
        if (res.ok && data.url) {
          setEditingGardener(prev => ({ ...prev, photoUrl: data.url }));
        } else {
          alert(data.error || 'Не удалось загрузить изображение');
        }
      } catch (err) {
        alert('Ошибка при загрузке фото');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateGardener = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/gardeners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingGardener.id,
          name: editingGardener.name,
          phone: editingGardener.phone,
          serviceIds: editingGardener.serviceIds,
          vkId: editingGardener.vkId ? String(editingGardener.vkId).trim() : null,
          videoUrl: editingGardener.photoUrl
        })
      });
      if (res.ok) {
        setEditingGardener(null);
        await fetchUsersAndGardeners();
      } else {
        const data = await res.json();
        alert(data.error || 'Ошибка при сохранении садовника');
      }
    } catch (err) {
      alert('Ошибка при сохранении садовника');
    }
  };

  const handleDeleteGardener = async (id) => {
    if (!confirm('Удалить этого садовника и его личный кабинет?')) return;
    const res = await fetch('/api/admin/gardeners', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) await fetchUsersAndGardeners();
  };

  const translateRole = (role) => {
    if (role === 'LEADER') return 'Руководитель';
    if (role === 'ADMIN') return 'Диспетчер';
    if (role === 'GARDENER') return 'Садовник';
    return role;
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
          <button
            onClick={() => router.back()}
            className="text-sm px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-all"
          >
            ← Назад
          </button>
        </div>

        {/* Секция: Добавить диспетчера */}
        <div className="mb-8 p-5 bg-emerald-50/60 border border-emerald-200 rounded-2xl">
          <h2 className="text-lg font-bold text-emerald-900 mb-3 flex items-center gap-2">
            ➕ Добавить диспетчера
          </h2>
          <form onSubmit={handleCreateDispatcher} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          Список пользователей (Администраторы / Диспетчеры)
        </h2>

        <div className="overflow-x-auto mb-10">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="p-3">Имя</th>
                <th className="p-3">Телефон</th>
                <th className="p-3">Роль</th>
                <th className="p-3">VK ID</th>
                <th className="p-3">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const input = userInputs[u.id] || { name: u.name, phone: u.phone, vkId: u.vkId || '' };
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
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white w-full max-w-[150px]"
                      />
                      {warnings[u.id] && (
                        <div className="mt-1 text-xs text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200">
                          {warnings[u.id]}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${u.role === 'LEADER' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>
                        {translateRole(u.role)}
                      </span>
                    </td>
                    <td className="p-3">
                      <input
                        type="text"
                        placeholder="Не привязан"
                        value={input.vkId}
                        onChange={(e) => handleInputChange(u.id, 'vkId', e.target.value)}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white w-full max-w-[130px]"
                      />
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

        {/* Секция: Список садовников */}
        <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center justify-between">
          <span>🧑‍🌾 Список садовников ({gardeners.length})</span>
        </h2>

        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
          {gardeners.map((g) => (
            <div key={g.id} className="p-4 bg-white hover:bg-slate-50">
              {editingGardener && editingGardener.id === g.id ? (
                <form onSubmit={handleUpdateGardener} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Имя садовника</label>
                      <input
                        type="text"
                        required
                        value={editingGardener.name}
                        onChange={e => setEditingGardener({ ...editingGardener, name: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Телефон</label>
                      <input
                        type="text"
                        required
                        value={editingGardener.phone}
                        onChange={e => setEditingGardener({ ...editingGardener, phone: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Умеет делать (услуги)</label>
                    <div className="flex flex-wrap gap-2">
                      {services.map(s => (
                        <label key={s.id} className={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer select-none transition-all ${editingGardener.serviceIds.includes(s.id) ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-semibold' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                          <input type="checkbox" className="hidden" checked={editingGardener.serviceIds.includes(s.id)} onChange={() => toggleEditGardenerService(s.id)} />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">VK ID</label>
                      <input
                        type="text"
                        value={editingGardener.vkId ?? ''}
                        onChange={e => setEditingGardener({ ...editingGardener, vkId: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                        placeholder="peer id или user id"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Фото садовника (ImgBB)</label>
                      <div className="flex items-center gap-2">
                        {editingGardener.photoUrl && (
                          <img src={editingGardener.photoUrl} alt={editingGardener.name} className="w-10 h-10 object-cover rounded-lg border border-slate-200" />
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileUpload}
                          className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-slate-200 justify-end">
                    <button type="button" onClick={() => setEditingGardener(null)} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">
                      Отмена
                    </button>
                    <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm">
                      Сохранить
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    {g.videoUrl || g.photoUrl ? (
                      <img src={g.videoUrl || g.photoUrl} alt={g.name} className="w-12 h-12 object-cover rounded-xl border border-slate-200" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xl">
                        🧑‍🌾
                      </div>
                    )}
                    <div>
                      <div className="font-semibold text-slate-800 flex items-center gap-2">
                        <span>{g.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                          {translateRole('GARDENER')}
                        </span>
                      </div>
                      <div className="text-slate-500 text-sm">Телефон: {g.phone}</div>
                      {g.services && g.services.length > 0 && (
                        <div className="text-xs text-emerald-700 mt-1">{g.services.map(s => s.name).join(', ')}</div>
                      )}
                      {g.vkId && (
                        <div className="text-xs text-slate-400 mt-1">VK ID: {g.vkId}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={() => openEditGardener(g)}
                      className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg transition-all"
                    >
                      Редактировать
                    </button>
                    <button
                      onClick={() => handleDeleteGardener(g.id)}
                      className="text-xs text-red-600 hover:bg-red-50 font-medium px-3 py-1.5 rounded-lg transition-all"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
