'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import GardenerModalEditor from '@/components/GardenerModalEditor';

export default function AdminUsersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [users, setUsers] = useState([]);
  const [gardeners, setGardeners] = useState([]);
  const [services, setServices] = useState([]);
  const [userInputs, setUserInputs] = useState({}); // userId => { name, phone, vkId }
  const [gardenerInputs, setGardenerInputs] = useState({}); // gardenerId => { name, phone, vkId }
  const [editingGardener, setEditingGardener] = useState(null);
  const [activeModal, setActiveModal] = useState(null); // { gardener, type }
  const [savingId, setSavingId] = useState(null);
  const [savingGardenerId, setSavingGardenerId] = useState(null);
  const [warnings, setWarnings] = useState({}); // id => warning text

  // Форма добавления нового диспетчера
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');

  useEffect(() => {
    fetch('/api/admin/gardeners').then(r => r.json()).then(data => setGardeners(data.gardeners || []));
  }, []);

  useEffect(() => {
    checkRoleAndFetchUsers();
  }, []);

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

  const handleGardenerUpdate = async (gardenerId, dataObj) => {
    try {
      const res = await fetch('/api/admin/gardeners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gardenerId, ...dataObj })
      });
      if (res.ok) {
        fetchUsersAndGardeners();
      } else {
        alert('Ошибка сохранения');
      }
    } catch (e) {
      alert('Ошибка при сохранении');
    }
  };

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

  const handleGardenerInputChange = (gardenerId, field, value) => {
    setGardenerInputs(prev => ({
      ...prev,
      [gardenerId]: {
        ...prev[gardenerId],
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

  const handleSaveGardenerQuick = async (gardener) => {
    const input = gardenerInputs[gardener.id];
    if (!input || !input.phone) {
      alert('Заполните номер телефона');
      return;
    }

    setSavingGardenerId(gardener.id);
    try {
      const res = await fetch('/api/admin/gardeners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: gardener.id,
          name: input.name || gardener.name,
          phone: input.phone,
          serviceIds: (gardener.services || []).map(s => s.id),
          vkId: input.vkId ? String(input.vkId).trim() : null,
          videoUrl: gardener.videoUrl || gardener.photoUrl || null
        })
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Не удалось обновить садовника');
        return;
      }

      await fetchUsersAndGardeners();
    } catch (err) {
      alert('Ошибка сохранения садовника');
    } finally {
      setSavingGardenerId(null);
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
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto bg-white rounded-2xl shadow border border-slate-200 p-4 sm:p-6">
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

        <div className="overflow-x-auto mb-6 relative">
          <table className="w-full text-left text-xs sm:text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="p-2 sticky left-0 z-30 bg-slate-100 min-w-[130px] border-r border-slate-200">Имя</th>
                <th className="p-2 min-w-[140px]">Телефон</th>
                <th className="p-2">Фото</th>
                <th className="p-2">Рейтинг</th>
                <th className="p-2">Отзывы</th>
                <th className="p-2">Навыки</th>
                <th className="p-2">Инвентарь</th>
                <th className="p-2">Препараты</th>
                <th className="p-2">Примеры работ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gardeners.map((g) => {
                const photo = g.photo || g.videoUrl || g.photoUrl;
                const parseLen = (v) => {
                  if (!v) return 0;
                  if (Array.isArray(v)) return v.length;
                  if (typeof v === 'string') {
                    try { return JSON.parse(v).length; } catch (e) { return 0; }
                  }
                  return 0;
                };

                return (
                  <tr key={g.id} className="hover:bg-slate-50 align-middle">
                    <td className="p-2 font-medium text-slate-800 sticky left-0 z-20 bg-white border-r border-slate-200">
                      <input
                        type="text"
                        defaultValue={g.name}
                        onBlur={(e) => handleGardenerUpdate(g.id, { name: e.target.value })}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-xs sm:text-sm bg-white w-full max-w-[120px]"
                      />
                    </td>
                    <td className="p-2 font-medium">
                      <input
                        type="text"
                        defaultValue={g.phone}
                        onBlur={(e) => handleGardenerUpdate(g.id, { phone: e.target.value })}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-xs sm:text-sm bg-white w-full max-w-[130px]"
                      />
                    </td>
                    <td className="p-2">
                      {photo ? (
                        <img src={photo} alt={g.name} className="w-9 h-9 object-cover rounded-lg border border-slate-200 mb-1" />
                      ) : null}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleGardenerPhotoUpload(g.id, e.target.files?.[0])}
                        className="text-[10px] sm:text-xs text-slate-500 file:mr-1 file:py-0.5 file:px-1.5 file:rounded file:border-0 file:text-[10px] file:bg-emerald-50 file:text-emerald-700"
                      />
                    </td>
                    <td className="p-2 font-semibold text-amber-600 whitespace-nowrap">
                      ★ {g.rating ?? 4.5}
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => setActiveModal({ gardener: g, type: 'reviews' })}
                        className="py-1 px-2 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg font-semibold text-xs border border-amber-200 whitespace-nowrap"
                      >
                        ★ {g.reviewsCount ?? parseLen(g.reviews)} отзывов
                      </button>
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => setActiveModal({ gardener: g, type: 'skills' })}
                        className="py-1 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs whitespace-nowrap"
                      >
                        Навыки ({parseLen(g.skills)})
                      </button>
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => setActiveModal({ gardener: g, type: 'inventory' })}
                        className="py-1 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs whitespace-nowrap"
                      >
                        Инвентарь ({parseLen(g.inventory)})
                      </button>
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => setActiveModal({ gardener: g, type: 'preparations' })}
                        className="py-1 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs whitespace-nowrap"
                      >
                        Препараты ({parseLen(g.preparations)})
                      </button>
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => setActiveModal({ gardener: g, type: 'works' })}
                        className="py-1 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs whitespace-nowrap"
                      >
                        Работы ({parseLen(g.works)})
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {activeModal && (
          <GardenerModalEditor
            gardener={activeModal.gardener}
            type={activeModal.type}
            onClose={() => setActiveModal(null)}
            onSave={async (gardenerId, dataObj) => {
              await handleGardenerUpdate(gardenerId, dataObj);
            }}
          />
        )}

        {/* Форма редактирования садовника с загрузкой фото */}
        {editingGardener && (
          <form onSubmit={handleUpdateGardener} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 mt-4">
            <h3 className="text-md font-bold text-slate-800">
              Редактирование профиля садовника: {editingGardener.name}
            </h3>
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
        )}
      </div>
    </div>
  );
}
