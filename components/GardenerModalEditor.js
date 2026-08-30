'use client';
import { useState } from 'react';

export default function GardenerModalEditor({ gardener, type, onClose, onSave }) {
  // type: 'skills' | 'inventory' | 'preparations' | 'works' | 'reviews'
  const parseItems = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch (e) { return []; }
    }
    return [];
  };

  const [items, setItems] = useState(parseItems(gardener[type]));
  const [uploading, setUploading] = useState(false);

  // Form states depending on type
  const [skillText, setSkillText] = useState('');

  const [invName, setInvName] = useState('');
  const [invDesc, setInvDesc] = useState('');
  const [invImage, setInvImage] = useState('');

  const [prepName, setPrepName] = useState('');
  const [prepDesc, setPrepDesc] = useState('');

  const [workTitle, setWorkTitle] = useState('');
  const [workImages, setWorkImages] = useState([]); // array of URLs

  const [revAuthor, setRevAuthor] = useState('');
  const [revText, setRevText] = useState('');
  const [revRating, setRevRating] = useState(5);

  const titles = {
    skills: 'Навыки',
    inventory: 'Инвентарь',
    preparations: 'Препараты',
    works: 'Примеры работ',
    reviews: 'Отзывы'
  };

  const handleFileUpload = async (e, setImageCallback) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploading(true);
    try {
      const uploadedUrls = [];
      for (const file of files) {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const res = await fetch('/api/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 })
        });
        const data = await res.json();
        if (res.ok && data.url) {
          uploadedUrls.push(data.url);
        } else {
          alert(data.error || 'Ошибка загрузки фото');
        }
      }

      if (uploadedUrls.length > 0) {
        setImageCallback(uploadedUrls);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка при загрузке изображения');
    } finally {
      setUploading(false);
    }
  };

  const handleAddItem = (e) => {
    e.preventDefault();
    let newItem = null;

    if (type === 'skills') {
      if (!skillText.trim()) return;
      newItem = skillText.trim();
      setSkillText('');
    } else if (type === 'inventory') {
      if (!invName.trim()) return;
      newItem = { name: invName.trim(), desc: invDesc.trim(), image: invImage };
      setInvName(''); setInvDesc(''); setInvImage('');
    } else if (type === 'preparations') {
      if (!prepName.trim()) return;
      newItem = { name: prepName.trim(), desc: prepDesc.trim() };
      setPrepName(''); setPrepDesc('');
    } else if (type === 'works') {
      if (!workTitle.trim()) return;
      newItem = { title: workTitle.trim(), images: workImages.length > 0 ? workImages : [], image: workImages[0] || '' };
      setWorkTitle(''); setWorkImages([]);
    } else if (type === 'reviews') {
      if (!revAuthor.trim() || !revText.trim()) return;
      newItem = { author: revAuthor.trim(), text: revText.trim(), rating: parseFloat(revRating) || 5 };
      setRevAuthor(''); setRevText(''); setRevRating(5);
    }

    if (newItem) {
      setItems([...items, newItem]);
    }
  };

  const handleDeleteItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const calculateRating = (revs) => {
    if (!revs || revs.length === 0) return 4.5;
    const sum = revs.reduce((acc, r) => acc + (parseFloat(r.rating) || 0), 0);
    return Number((sum / revs.length).toFixed(1));
  };

  const handleSaveAll = async () => {
    if (type === 'reviews') {
      const newRating = calculateRating(items);
      await onSave(gardener.id, {
        reviews: items,
        rating: newRating,
        reviewsCount: items.length
      });
    } else {
      await onSave(gardener.id, { [type]: items });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
          <h3 className="text-lg font-bold text-slate-900 truncate pr-2">
            Редактирование {titles[type]} ({gardener.name})
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold text-lg flex-shrink-0">
            ✕
          </button>
        </div>

        {/* Список элементов */}
        <div className="mb-6 space-y-3">
          {items.length === 0 ? (
            <div className="text-xs text-slate-400 italic">Список пуст</div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto border border-slate-100 rounded-lg p-2">
              {items.map((item, idx) => {
                const workImgList = item.images && Array.isArray(item.images) ? item.images : item.image ? [item.image] : [];
                return (
                  <div key={idx} className="flex items-center justify-between gap-3 p-2 bg-slate-50 rounded-lg border border-slate-100 min-w-0">
                    <div className="flex-1 min-w-0">
                      {type === 'skills' && <span className="text-xs text-slate-800 font-medium truncate block">{item}</span>}
                      {type === 'inventory' && (
                        <div className="flex items-center gap-3">
                          {item.image && (
                            <img src={item.image} alt={item.name} className="w-20 h-20 object-cover rounded-lg border border-slate-200 flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-xs text-slate-800 truncate">{item.name}</div>
                            {item.desc && <div className="text-slate-500 text-xs truncate">{item.desc}</div>}
                          </div>
                        </div>
                      )}
                      {type === 'preparations' && (
                        <div className="min-w-0">
                          <div className="font-bold text-xs text-slate-800 truncate">{item.name}</div>
                          {item.desc && <div className="text-slate-500 text-xs truncate">{item.desc}</div>}
                        </div>
                      )}
                      {type === 'works' && (
                        <div className="space-y-1 min-w-0">
                          <div className="font-bold text-xs text-slate-800 truncate">{item.title}</div>
                          {workImgList.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-1">
                              {workImgList.map((img, i) => (
                                <img key={i} src={img} alt={`${item.title} ${i+1}`} className="w-20 h-20 object-cover rounded-lg border border-slate-200 flex-shrink-0" />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {type === 'reviews' && (
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-xs text-slate-800 truncate">{item.author}</span>
                            <span className="text-amber-600 font-bold text-xs flex-shrink-0">★ {item.rating}</span>
                          </div>
                          <div className="text-slate-600 text-xs mt-0.5 line-clamp-2">{item.text}</div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteItem(idx)}
                      className="py-1 px-2.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg font-semibold text-xs flex-shrink-0 transition-colors"
                    >
                      Удалить
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Форма добавления */}
        <form onSubmit={handleAddItem} className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6 space-y-3">
          <h4 className="text-xs font-bold text-slate-700 uppercase">Добавить элемент</h4>

          {type === 'skills' && (
            <input
              type="text"
              placeholder="Название навыка (например: Обрезка яблонь)"
              value={skillText}
              onChange={(e) => setSkillText(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          )}

          {type === 'inventory' && (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Название инструмента (например: Кусторез)"
                value={invName}
                onChange={(e) => setInvName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="text"
                placeholder="Описание (опционально)"
                value={invDesc}
                onChange={(e) => setInvDesc(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <div className="flex items-center gap-2">
                {invImage && <img src={invImage} alt="Превью" className="w-20 h-20 object-cover rounded-lg border border-slate-200" />}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFileUpload(e, (urls) => setInvImage(urls[0]))}
                  className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                />
              </div>
            </div>
          )}

          {type === 'preparations' && (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Название препарата (например: Бордоская смесь)"
                value={prepName}
                onChange={(e) => setPrepName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="text"
                placeholder="Описание / Назначение"
                value={prepDesc}
                onChange={(e) => setPrepDesc(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          )}

          {type === 'works' && (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Название/Заголовок работы"
                value={workTitle}
                onChange={(e) => setWorkTitle(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <div className="space-y-2">
                {workImages.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {workImages.map((img, i) => (
                      <img key={i} src={img} alt={`Предпросмотр ${i+1}`} className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                    ))}
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleFileUpload(e, (urls) => setWorkImages([...workImages, ...urls]))}
                  className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                />
              </div>
            </div>
          )}

          {type === 'reviews' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Автор (например: Мария В.)"
                  value={revAuthor}
                  onChange={(e) => setRevAuthor(e.target.value)}
                  className="border border-slate-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="5"
                  placeholder="Оценка (1-5)"
                  value={revRating}
                  onChange={(e) => setRevRating(e.target.value)}
                  className="border border-slate-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <textarea
                placeholder="Текст отзыва"
                value={revText}
                onChange={(e) => setRevText(e.target.value)}
                rows={2}
                className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={uploading}
            className="py-1.5 px-3 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs rounded-lg transition-all disabled:opacity-50"
          >
            {uploading ? 'Загрузка...' : '+ Добавить'}
          </button>
        </form>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="py-2 px-4 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold"
          >
            Отмена
          </button>
          <button
            onClick={handleSaveAll}
            className="py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm"
          >
            Сохранить всё
          </button>
        </div>
      </div>
    </div>
  );
}
