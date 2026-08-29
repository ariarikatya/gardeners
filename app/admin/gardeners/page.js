'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminGardenersPage() {
  const router = useRouter();
  const [gardeners, setGardeners] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGardeners();
  }, []);

  const fetchGardeners = async () => {
    try {
      const res = await fetch('/api/admin/gardeners');
      const data = await res.json();
      setGardeners(data.gardeners || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleGardenerPhotoUpload = async (gardenerId, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
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
      } catch (err) {
        alert('Ошибка при загрузке фото');
      }
    };
    reader.readAsDataURL(file);
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
        fetchGardeners();
      } else {
        alert('Ошибка сохранения');
      }
    } catch (e) {
      alert('Ошибка при сохранении');
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Загрузка садовников...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            🧑‍🌾 Управление садовниками
          </h1>
          <button
            onClick={() => router.back()}
            className="text-sm px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-all"
          >
            ← Назад
          </button>
        </div>

        <div className="overflow-x-auto">
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
