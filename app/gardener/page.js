'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const WEEKDAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTH_LABELS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const currency = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });

function statusStyle(status) {
  switch (status) {
    case 'Выполнен': return 'bg-slate-300';
    case 'Отменен': return 'bg-slate-200';
    case 'Перенос': return 'bg-blue-400';
    case 'Отказ': return 'bg-rose-400';
    default: return 'bg-emerald-500';
  }
}

// Сжимаем фото перед загрузкой, чтобы не упереться в лимит размера запроса
function compressImage(file, maxWidth = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не удалось обработать фото'))), 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('Не удалось прочитать фото'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

export default function GardenerDashboard() {
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
  const [walletRange, setWalletRange] = useState('month');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDateStr, setSelectedDateStr] = useState(null);

  // Модалка действия по заказу
  const [actionOrder, setActionOrder] = useState(null);
  const [actionType, setActionType] = useState(null); // 'transfer' | 'refuse' | 'complete'
  const [transferDate, setTransferDate] = useState('');
  const [refusalText, setRefusalText] = useState('');
  const [factAmount, setFactAmount] = useState('');
  const [photoBeforeUrl, setPhotoBeforeUrl] = useState('');
  const [photoAfterUrl, setPhotoAfterUrl] = useState('');
  const [photoActUrl, setPhotoActUrl] = useState('');
  const [uploadingWhich, setUploadingWhich] = useState(null); // 'before' | 'after' | 'act' | null
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/gardener/orders');
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const openAction = (order, type) => {
    setActionOrder(order);
    setActionType(type);
    setTransferDate('');
    setRefusalText('');
    setFactAmount('');
    setPhotoBeforeUrl('');
    setPhotoAfterUrl('');
    setPhotoActUrl('');
  };

  const closeAction = () => {
    setActionOrder(null);
    setActionType(null);
  };

  const handlePhotoSelect = async (e, which) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingWhich(which);
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('image', compressed, 'photo.jpg');
      const res = await fetch('/api/gardener/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        if (which === 'before') setPhotoBeforeUrl(data.url);
        if (which === 'after') setPhotoAfterUrl(data.url);
        if (which === 'act') setPhotoActUrl(data.url);
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Не удалось загрузить фото: ' + err.message);
    } finally {
      setUploadingWhich(null);
      e.target.value = '';
    }
  };

  const submitAction = async (e) => {
    e.preventDefault();
    if (!actionOrder) return;

    if (actionType === 'complete' && (!photoBeforeUrl || !photoAfterUrl || !photoActUrl)) {
      alert('Прикрепите все три фото: до, после и акт/документ');
      return;
    }

    setSubmitting(true);

    const payload = { id: actionOrder.id, action: actionType };
    if (actionType === 'transfer') payload.transferRequestedDate = transferDate;
    if (actionType === 'refuse') payload.refusalReason = refusalText;
    if (actionType === 'complete') {
      payload.priceFact = factAmount;
      payload.photoBefore = photoBeforeUrl;
      payload.photoAfter = photoAfterUrl;
      payload.photoAct = photoActUrl;
    }

    try {
      const res = await fetch('/api/gardener/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeAction();
        fetchOrders();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', weekday: 'long'
  });

  const getWalletRange = (scope) => {
    const now = new Date();
    if (scope === 'quarter') {
      const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start, end };
    }
    if (scope === 'year') {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31);
      return { start, end };
    }
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start, end };
  };

  const walletSummary = (() => {
    const { start, end } = getWalletRange(walletRange);
    let earned = 0;
    let companyDebt = 0;
    let pending = 0;
    let payout = 0;

    orders.forEach((order) => {
      const orderDate = new Date(order.date);
      if (orderDate < start || orderDate > end) return;

      const gross = Number(order.status === 'Выполнен' ? (order.priceFact || 0) : (order.priceContract || order.priceFact || 0));
      const companyShare = Number(order.companyShare || 0);
      const net = Math.max(gross - companyShare, 0);

      if (order.status === 'Выполнен') {
        earned += Number(order.priceFact || 0);
        companyDebt += companyShare;
        payout += net;
      } else if (!['Отменен', 'Отказ'].includes(order.status)) {
        pending += net;
      }
    });

    return { earned, companyDebt, pending, payout: earned - companyDebt + pending };
  })();

  const formatMoney = (value) => currency.format(Number(value || 0));

  const renderOrderCard = (order) => (
    <div key={order.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-2 ${statusStyle(order.status)}`}></div>
      <div className="pl-2">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-semibold text-emerald-700 capitalize">{formatDate(order.date)}</div>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{order.status}</span>
        </div>
        <div className="text-lg font-bold text-slate-900 mb-2">{order.clientName}</div>
        {order.service && (
          <div className="text-xs font-medium text-emerald-700 mb-2">🌿 {order.service.name}</div>
        )}

        <div className="space-y-2 text-sm text-slate-600">
          <div>📍 <span className="font-medium text-slate-800">{order.district ? `${order.district} • ${order.address}` : order.address}</span></div>
          {/* Показывать телефон только за сутки до заказа или после выполнения */}
          {(() => {
            const now = new Date();
            const orderDate = new Date(order.date);
            const msUntil = orderDate.getTime() - now.getTime();
            const showPhone = order.status === 'Выполнен' || (msUntil <= 24 * 3600 * 1000 && msUntil >= 0);
            return showPhone ? (
              <div>📞 <a href={`tel:${order.clientPhone}`} className="text-emerald-600 font-medium underline">{order.clientPhone}</a></div>
            ) : (
              <div>📞 <span className="text-slate-400">Номер скрыт</span></div>
            );
          })()}
          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-slate-700 mt-2">
            <div className="text-xs font-semibold text-slate-400 mb-0.5">Что делать:</div>
            {order.description}
          </div>
          {order.comment && (
            <div className="text-xs text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-100">
              📝 {order.comment}
            </div>
          )}
          {order.status === 'Перенос' && order.transferRequestedDate && (
            <div className="text-xs text-blue-800 bg-blue-50 p-2 rounded-lg border border-blue-100">
              Запрошен перенос на {new Date(order.transferRequestedDate).toLocaleDateString('ru-RU')}. Ждём решения диспетчера.
            </div>
          )}
          {order.status === 'Отказ' && order.refusalReason && (
            <div className="text-xs text-rose-800 bg-rose-50 p-2 rounded-lg border border-rose-100">
              Причина отказа: {order.refusalReason}
            </div>
          )}
          {order.status === 'Выполнен' && (
            <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">
              Сумма по факту: {order.priceFact} ₽
            </div>
          )}
        </div>

        {order.status === 'Новый заказ' && (
          <div className="flex gap-2 mt-3">
            <button onClick={() => openAction(order, 'transfer')} className="flex-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg py-2 font-medium hover:bg-blue-100">
              Перенос
            </button>
            <button onClick={() => openAction(order, 'refuse')} className="flex-1 text-xs bg-rose-50 text-rose-700 border border-rose-200 rounded-lg py-2 font-medium hover:bg-rose-100">
              Отказ
            </button>
            <button onClick={() => openAction(order, 'complete')} className="flex-1 text-xs bg-emerald-600 text-white rounded-lg py-2 font-medium hover:bg-emerald-700">
              Выполнено
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // --- Данные для вида "Календарь" ---
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // понедельник — первый день недели
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const ordersByDate = {};
  orders.forEach(o => {
    const key = o.date.split('T')[0];
    if (!ordersByDate[key]) ordersByDate[key] = [];
    ordersByDate[key].push(o);
  });

  const calendarCells = [];
  for (let i = 0; i < startOffset; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);

  const goToPrevMonth = () => setCalendarMonth(new Date(year, month - 1, 1));
  const goToNextMonth = () => setCalendarMonth(new Date(year, month + 1, 1));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-emerald-800 text-white py-4 px-4 flex justify-between items-center shadow">
        <h1 className="text-lg font-bold flex items-center gap-1">🌿 Мой Кабинет</h1>
        <div className="flex items-center gap-2">
          <a href="tel:88452650206" className="text-xs bg-emerald-700 hover:bg-emerald-600 px-3 py-1.5 rounded-lg flex items-center gap-1">
            📞 Диспетчер
          </a>
          <button onClick={handleLogout} className="text-xs bg-emerald-700 px-3 py-1.5 rounded-lg">Выйти</button>
        </div>
      </header>

      <main className="p-4 max-w-md md:max-w-4xl mx-auto">
        <div className="mb-4 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
            <h2 className="text-xl font-bold text-emerald-900">Кошелёк</h2>
            <div className="flex gap-2 bg-slate-100 rounded-lg p-1">
              {['month', 'quarter', 'year'].map((scope) => (
                <button
                  key={scope}
                  onClick={() => setWalletRange(scope)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${walletRange === scope ? 'bg-emerald-600 text-white' : 'text-slate-600'}`}
                >
                  {scope === 'month' ? 'Месяц' : scope === 'quarter' ? 'Квартал' : 'Год'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
              <div className="text-[11px] uppercase text-emerald-700">Заработано</div>
              <div className="text-2xl font-bold text-emerald-800">{formatMoney(walletSummary.earned)}</div>
            </div>
            <div className="bg-rose-50 border border-rose-100 rounded-xl p-3">
              <div className="text-[11px] uppercase text-rose-700">Должен фирме</div>
              <div className="text-2xl font-bold text-rose-800">{formatMoney(walletSummary.companyDebt)}</div>
            </div>
            <div className="bg-violet-50 border border-violet-100 rounded-xl p-3">
              <div className="text-[11px] uppercase text-violet-700">Будет начислено</div>
              <div className="text-2xl font-bold text-violet-800">{formatMoney(walletSummary.pending)}</div>
            </div>
            <div className="bg-sky-50 border border-sky-100 rounded-xl p-3">
              <div className="text-[11px] uppercase text-sky-700">К выплате</div>
              <div className="text-2xl font-bold text-sky-800">{formatMoney(walletSummary.payout)}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-emerald-900">Мои заказы</h2>
          <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden text-sm">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 font-medium ${viewMode === 'list' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500'}`}
            >
              Список
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 font-medium ${viewMode === 'calendar' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500'}`}
            >
              Календарь
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-slate-500 py-8">Загрузка...</div>
        ) : orders.length === 0 ? (
          <div className="text-center text-slate-500 py-8 bg-white border rounded-xl">У вас пока нет назначенных заказов</div>
        ) : viewMode === 'list' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {orders.map(renderOrderCard)}
          </div>
        ) : (
          <div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 mb-4 max-w-sm mx-auto">
              <div className="flex items-center justify-between mb-3">
                <button onClick={goToPrevMonth} className="px-2 py-1 rounded-lg hover:bg-slate-100 text-slate-500">←</button>
                <div className="font-semibold text-slate-700 text-sm">{MONTH_LABELS[month]} {year}</div>
                <button onClick={goToNextMonth} className="px-2 py-1 rounded-lg hover:bg-slate-100 text-slate-500">→</button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-400 mb-1">
                {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(l => <div key={l}>{l}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((d, i) => {
                  if (d === null) return <div key={i}></div>;
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const dayOrders = ordersByDate[dateStr] || [];
                  const isSelected = selectedDateStr === dateStr;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDateStr(isSelected ? null : dateStr)}
                      className={`aspect-square rounded-lg text-xs flex flex-col items-center justify-center gap-0.5 border ${
                        isSelected ? 'border-emerald-500 bg-emerald-50' : dayOrders.length > 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100'
                      }`}
                    >
                      {/* Чёрным/тёмно-серым помечаем выходные (сб/вс) */}
                      {(() => {
                        const cellDate = new Date(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
                        const wd = cellDate.getDay();
                        const isWeekend = wd === 0 || wd === 6;
                        return (
                          <span className={`font-medium ${isWeekend ? 'text-white bg-slate-800 rounded-full px-2 py-0.5' : 'text-slate-700'}`}>{d}</span>
                        );
                      })()}
                      {dayOrders.length > 0 && (
                        <div className="flex items-center gap-0.5 mt-1">
                          {Array.from({ length: dayOrders.length }).slice(0,6).map((_, idx) => (
                            <span key={idx} className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedDateStr && (
              (ordersByDate[selectedDateStr] || []).length === 0 ? (
                <p className="text-sm text-slate-400 text-center">В этот день заказов нет</p>
              ) : ordersByDate[selectedDateStr].length === 1 ? (
                <div className="flex justify-center">
                  <div className="w-full md:max-w-md">{renderOrderCard(ordersByDate[selectedDateStr][0])}</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {ordersByDate[selectedDateStr].map(renderOrderCard)}
                </div>
              )
            )}
          </div>
        )}
      </main>

      {/* Модалка действия: перенос / отказ / выполнено */}
      {actionOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800 mb-3">
              {actionType === 'transfer' && 'Запросить перенос'}
              {actionType === 'refuse' && 'Отказаться от заказа'}
              {actionType === 'complete' && 'Заказ выполнен'}
            </h3>

            <form onSubmit={submitAction} className="space-y-4">
              {actionType === 'transfer' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Желаемая дата клиента</label>
                  <input
                    type="date" required
                    value={transferDate}
                    onChange={e => setTransferDate(e.target.value)}
                    className="mt-1 block w-full border border-slate-300 rounded-lg p-2"
                  />
                  <p className="text-xs text-slate-400 mt-2">Диспетчер увидит запрос и сам подберёт новую дату или другого садовника.</p>
                </div>
              )}

              {actionType === 'refuse' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Причина отказа (обязательно)</label>
                  <textarea
                    required
                    value={refusalText}
                    onChange={e => setRefusalText(e.target.value)}
                    className="mt-1 block w-full border border-slate-300 rounded-lg p-2"
                    rows={3}
                  />
                </div>
              )}

              {actionType === 'complete' && (
                <>
                  {[
                    { key: 'before', label: 'Фото «До»', url: photoBeforeUrl },
                    { key: 'after', label: 'Фото «После»', url: photoAfterUrl },
                    { key: 'act', label: 'Фото акта / документа', url: photoActUrl },
                  ].map(({ key, label, url }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
                      {url ? (
                        <div className="flex items-center gap-2">
                          <img src={url} alt={label} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                          <span className="text-xs text-emerald-700 font-medium">Загружено ✓</span>
                          <label className="text-xs text-slate-400 underline cursor-pointer ml-auto">
                            Заменить
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handlePhotoSelect(e, key)} />
                          </label>
                        </div>
                      ) : (
                        <label className="relative flex items-center justify-center gap-2 border border-dashed border-slate-300 rounded-lg p-3 text-sm text-slate-500 cursor-pointer hover:bg-slate-50">
                          {uploadingWhich === key ? 'Загружаю...' : '📷 Выбрать фото'}
                          <input style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0 }} type="file" accept="image/*" capture="environment" onChange={e => handlePhotoSelect(e, key)} disabled={uploadingWhich === key} />
                        </label>
                      )}
                    </div>
                  ))}

                  <div>
                    <label className="block text-xs font-semibold text-slate-500">Фактическая сумма заказа, ₽</label>
                    <input
                      type="number" required min="1" step="1"
                      value={factAmount}
                      onChange={e => setFactAmount(e.target.value)}
                      className="mt-1 block w-full border border-slate-300 rounded-lg p-2"
                    />
                    <p className="text-xs text-slate-400 mt-2">Без всех трёх фото и суммы заказ нельзя закрыть как выполненный.</p>
                  </div>
                </>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={closeAction} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600">
                  Отмена
                </button>
                <button type="submit" disabled={submitting || uploadingWhich !== null} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50">
                  {submitting ? 'Сохраняю...' : 'Подтвердить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
