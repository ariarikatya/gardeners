'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import GardenerModalEditor from '@/components/GardenerModalEditor';

export default function AdminGardenersPage() {
  const router = useRouter();
  const [gardeners, setGardeners] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState(null); // { gardener, type }
  const [editingGardener, setEditingGardener] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [resG, resS] = await Promise.all([
        fetch('/api/admin/gardeners'),
        fetch('/api/admin/services')
      ]);
      const dataG = await resG.json();
      const dataS = await resS.json();
      setGardeners(dataG.gardeners || []);
      setServices(dataS.services || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleGardenerPhotoUpload = async (gardenerId, file) => {
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result.split(',')[1];
        const uploadRes = await fetch('/api/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 }),
        });
        const data = await uploadRes.json();
        if (uploadRes.ok && data.url) {
          await fetch('/api/admin/gardeners', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: gardenerId,
              photo: data.url
            }),
          });
          setGardeners(gardeners.map(item => item.id === gardenerId ? { ...item, photo: data.url, photoUrl: data.url, videoUrl: data.url } : item));
        } else {
          alert(data.error || 'Ошибка загрузки изображения');
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      alert('Ошибка при загрузке фото');
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
        fetchData();
      } else {
        alert('Ошибка сохранения');
      }
    } catch (e) {
      alert('Ошибка при сохранении');
    }
  };

  const openEditGardener = (g) => {
    setEditingGardener({
      id: g.id,
      name: g.name,
      phone: g.phone,
      serviceIds: (g.services || []).map(s => s.id),
      vkId: g.vkId || '',
      photoUrl: g.photo || g.videoUrl || g.photoUrl || ''
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
      const base64 = evt.target.result.split(',')[1];
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
          photo: editingGardener.photoUrl
        })
      });
      if (res.ok) {
        setEditingGardener(null);
        await fetchData();
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
    if (res.ok) await fetchData();
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Загрузка садовников...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto bg-white rounded-2xl shadow border border-slate-200 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            🧑‍🌾 Управление садовниками ({gardeners.length})
          </h1>
          <button
            onClick={() => router.back()}
            className="text-sm px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-all"
          >
            ← Назад
          </button>
        </div>

        <div className="overflow-x-auto relative mb-6">
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
                <th className="p-2">Действия</th>
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
                    <td className="p-2 whitespace-nowrap">
                      <button
                        onClick={() => openEditGardener(g)}
                        className="py-1 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg font-medium text-xs border border-emerald-200"
                      >
                        ⚙️ Опции
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Форма редактирования дополнительных опций садовника (услуги, VK ID) */}
        {editingGardener && (
          <form onSubmit={handleUpdateGardener} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 mb-6">
            <div className="flex items-center justify-between">
              <h3 className="text-md font-bold text-slate-800">
                Дополнительные опции садовника: {editingGardener.name}
              </h3>
              <button
                type="button"
                onClick={() => handleDeleteGardener(editingGardener.id)}
                className="px-3 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold"
              >
                🗑 Удалить садовника
              </button>
            </div>
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

            {services.length > 0 && (
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
            )}

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
    </div>
  );
}
