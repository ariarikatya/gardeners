'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LeaderUsersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [users, setUsers] = useState([]);
  const [gardeners, setGardeners] = useState([]);
  const [services, setServices] = useState([]);
  const [userInputs, setUserInputs] = useState({});
  const [gardenerInputs, setGardenerInputs] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [savingGardenerId, setSavingGardenerId] = useState(null);
  const [warnings, setWarnings] = useState({});

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
        router.push('/leader');
        return;
      }
      const meData = await meRes.json();
      if (!meData.user || meData.user.role !== 'LEADER') {
        router.push('/leader');
        return;
      }
      setCurrentUserRole(meData.user.role);

      await fetchUsersAndGardeners();
    } catch (e) {
      console.error(e);
      router.push('/leader');
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
        router.push('/leader');
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

      const gInputs = {};
      (dataGardeners.gardeners || []).forEach(g => {
        gInputs[g.id] = { name: g.name || '', phone: g.phone || '', vkId: g.vkId || '' };
      });
      setGardenerInputs(gInputs);
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

  const handleGardenerPhotoUpload = async (gardenerId, file) => {
    if (!file) return;
    console.log('Загрузка фото для садовника:', gardenerId, file);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result.split(',')[1];
        const uploadRes = await fetch('/api/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 })
        });
        const uploadData = await uploadRes.json();
        console.log('Upload response:', uploadRes.status, uploadData);
        if (uploadRes.ok && uploadData.url) {
          await fetch('/api/admin/gardeners', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: gardenerId, photo: uploadData.url })
          });
          setGardeners(gardeners.map(g => g.id === gardenerId ? { ...g, photo: uploadData.url, photoUrl: uploadData.url, videoUrl: uploadData.url } : g));
        } else {
          alert(uploadData.error || 'Ошибка загрузки фото');
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Upload error:', err);
      alert('Ошибка соединения при загрузке фото');
    }
  };

  const handleGardenerUpdate = async (gardenerId, field, value) => {
    try {
      const res = await fetch('/api/admin/gardeners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gardenerId, [field]: value })
      });
      if (res.ok) {
        alert('Сохранено');
        fetchUsersAndGardeners();
      } else {
        alert('Ошибка сохранения');
      }
    } catch (e) {
      alert('Ошибка сохранения');
    }
  };

  const handleSaveUser = async (user) => {
    const input = userInputs[user.id];
    if (!input || !input.phone) {
      alert('Заполните номер телефона');
      return;
    }

    setSavingId(user.id);
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
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            👥 Управление пользователями и садовниками
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

        <div className="overflow-x-auto mb-6">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="p-3">Имя</th>
                <th className="p-3">Телефон</th>
                <th className="p-3">Фото</th>
                <th className="p-3">Рейтинг</th>
                <th className="p-3">Отзывы</th>
                <th className="p-3">Навыки</th>
                <th className="p-3">Инвентарь</th>
                <th className="p-3">Препараты</th>
                <th className="p-3">Примеры работ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gardeners.map((g) => {
                const photo = g.photo || g.videoUrl || g.photoUrl;
                return (
                  <tr key={g.id} className="hover:bg-slate-50 align-top">
                    <td className="p-3 font-medium text-slate-800">
                      <input
                        type="text"
                        defaultValue={g.name}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white w-full max-w-[120px]"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget.previousElementSibling;
                          handleGardenerUpdate(g.id, 'name', input.value);
                        }}
                        className="mt-1 block py-1 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg"
                      >
                        Сохранить
                      </button>
                    </td>
                    <td className="p-3 font-medium">
                      <input
                        type="text"
                        defaultValue={g.phone}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white w-full max-w-[130px]"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget.previousElementSibling;
                          handleGardenerUpdate(g.id, 'phone', input.value);
                        }}
                        className="mt-1 block py-1 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg"
                      >
                        Сохранить
                      </button>
                    </td>
                    <td className="p-3">
                      {photo ? (
                        <img src={photo} alt={g.name} className="w-12 h-12 object-cover rounded-lg border border-slate-200 mb-2" />
                      ) : null}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleGardenerPhotoUpload(g.id, e.target.files?.[0])}
                        className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                      />
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        step="0.1"
                        defaultValue={g.rating ?? 4.5}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white w-20"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget.previousElementSibling;
                          handleGardenerUpdate(g.id, 'rating', parseFloat(input.value));
                        }}
                        className="mt-1 block py-1 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg"
                      >
                        Сохранить
                      </button>
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        defaultValue={g.reviewsCount ?? 0}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white w-20"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget.previousElementSibling;
                          handleGardenerUpdate(g.id, 'reviewsCount', parseInt(input.value, 10));
                        }}
                        className="mt-1 block py-1 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg"
                      >
                        Сохранить
                      </button>
                    </td>
                    <td className="p-3">
                      <textarea
                        defaultValue={typeof g.skills === 'object' ? JSON.stringify(g.skills, null, 2) : g.skills || ''}
                        rows={3}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white w-32 font-mono"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          const textarea = e.currentTarget.previousElementSibling;
                          handleGardenerUpdate(g.id, 'skills', textarea.value);
                        }}
                        className="mt-1 block py-1 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg"
                      >
                        Сохранить
                      </button>
                    </td>
                    <td className="p-3">
                      <textarea
                        defaultValue={typeof g.inventory === 'object' ? JSON.stringify(g.inventory, null, 2) : g.inventory || ''}
                        rows={3}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white w-32 font-mono"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          const textarea = e.currentTarget.previousElementSibling;
                          handleGardenerUpdate(g.id, 'inventory', textarea.value);
                        }}
                        className="mt-1 block py-1 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg"
                      >
                        Сохранить
                      </button>
                    </td>
                    <td className="p-3">
                      <textarea
                        defaultValue={typeof g.preparations === 'object' ? JSON.stringify(g.preparations, null, 2) : g.preparations || ''}
                        rows={3}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white w-32 font-mono"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          const textarea = e.currentTarget.previousElementSibling;
                          handleGardenerUpdate(g.id, 'preparations', textarea.value);
                        }}
                        className="mt-1 block py-1 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg"
                      >
                        Сохранить
                      </button>
                    </td>
                    <td className="p-3">
                      <textarea
                        defaultValue={typeof g.works === 'object' ? JSON.stringify(g.works, null, 2) : g.works || ''}
                        rows={3}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white w-32 font-mono"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          const textarea = e.currentTarget.previousElementSibling;
                          handleGardenerUpdate(g.id, 'works', textarea.value);
                        }}
                        className="mt-1 block py-1 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg"
                      >
                        Сохранить
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
