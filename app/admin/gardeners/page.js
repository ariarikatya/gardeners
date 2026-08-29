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
        const base64 = reader.result;
        const uploadRes = await fetch('/api/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 }),
        });
        const data = await uploadRes.json();
        if (uploadRes.ok && data.url) {
          const g = gardeners.find(item => item.id === gardenerId);
          await fetch('/api/admin/gardeners', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: gardenerId,
              name: g ? g.name : '',
              phone: g ? g.phone : '',
              serviceIds: g && g.services ? g.services.map(s => s.id) : [],
              vkId: g ? g.vkId : null,
              videoUrl: data.url
            }),
          });
          setGardeners(gardeners.map(item => item.id === gardenerId ? { ...item, videoUrl: data.url, photoUrl: data.url } : item));
        } else {
          alert(data.error || 'Ошибка загрузки изображения');
        }
      } catch (err) {
        alert('Ошибка при загрузке фото');
      }
    };
    reader.readAsDataURL(file);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Загрузка садовников...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow border border-slate-200 p-6">
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
                <th className="p-3">Загрузить фото</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gardeners.map((g) => {
                const photo = g.videoUrl || g.photoUrl;
                return (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-800">{g.name}</td>
                    <td className="p-3 font-medium">{g.phone}</td>
                    <td className="p-3">
                      {photo ? (
                        <img src={photo} alt={g.name} className="w-12 h-12 object-cover rounded-lg border border-slate-200" />
                      ) : (
                        <span className="text-xs text-slate-400">Нет фото</span>
                      )}
                    </td>
                    <td className="p-3">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleGardenerPhotoUpload(g.id, e.target.files?.[0])}
                        className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                      />
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
