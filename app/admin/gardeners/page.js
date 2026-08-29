'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import GardenerModalEditor from '@/components/GardenerModalEditor';

export default function AdminGardenersPage() {
  const router = useRouter();
  const [gardeners, setGardeners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState(null); // { gardener, type }

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

  const handleGardenerUpdate = async (gardenerId, dataObj) => {
    try {
      const res = await fetch('/api/admin/gardeners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gardenerId, ...dataObj })
      });
      if (res.ok) {
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
                    <td className="p-3 font-medium text-slate-800">
                      <input
                        type="text"
                        defaultValue={g.name}
                        onBlur={(e) => handleGardenerUpdate(g.id, { name: e.target.value })}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white w-full max-w-[120px]"
                      />
                    </td>
                    <td className="p-3 font-medium">
                      <input
                        type="text"
                        defaultValue={g.phone}
                        onBlur={(e) => handleGardenerUpdate(g.id, { phone: e.target.value })}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white w-full max-w-[130px]"
                      />
                    </td>
                    <td className="p-3">
                      {photo ? (
                        <img src={photo} alt={g.name} className="w-10 h-10 object-cover rounded-lg border border-slate-200 mb-1" />
                      ) : null}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleGardenerPhotoUpload(g.id, e.target.files?.[0])}
                        className="text-xs text-slate-500 file:mr-1 file:py-0.5 file:px-2 file:rounded file:border-0 file:text-xs file:bg-emerald-50 file:text-emerald-700"
                      />
                    </td>
                    <td className="p-3 font-semibold text-amber-600">
                      ★ {g.rating ?? 4.5}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => setActiveModal({ gardener: g, type: 'reviews' })}
                        className="py-1 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg font-semibold text-xs border border-amber-200"
                      >
                        ★ {g.reviewsCount ?? parseLen(g.reviews)} отзывов
                      </button>
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => setActiveModal({ gardener: g, type: 'skills' })}
                        className="py-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs"
                      >
                        Навыки ({parseLen(g.skills)})
                      </button>
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => setActiveModal({ gardener: g, type: 'inventory' })}
                        className="py-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs"
                      >
                        Инвентарь ({parseLen(g.inventory)})
                      </button>
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => setActiveModal({ gardener: g, type: 'preparations' })}
                        className="py-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs"
                      >
                        Препараты ({parseLen(g.preparations)})
                      </button>
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => setActiveModal({ gardener: g, type: 'works' })}
                        className="py-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs"
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
