'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const WEEKDAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTH_LABELS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

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
  const [expenses, setExpenses] = useState([]);
  const [activeSection, setActiveSection] = useState('orders');
  const [expenseForm, setExpenseForm] = useState({ date: new Date().toISOString().split('T')[0], amount: '', description: '' });
  const [expenseReceiptUrl, setExpenseReceiptUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
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
  const [extraPhotoUrls, setExtraPhotoUrls] = useState([]);
  const [uploadingWhich, setUploadingWhich] = useState(null); // 'before' | 'after' | 'act' | null
  const [submitting, setSubmitting] = useState(false);
  const [contactStatus, setContactStatus] = useState('');

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const [ordersRes, expensesRes] = await Promise.all([fetch('/api/gardener/orders'), fetch('/api/gardener/expenses')]);
      const data = await ordersRes.json();
      const expensesData = await expensesRes.json();
      setOrders(data.orders || []);
      setExpenses(expensesData.expenses || []);
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
    setExtraPhotoUrls([]);
    setContactStatus(order.contactStatus || '');
  };

  const closeAction = () => {
    setActionOrder(null);
    setActionType(null);
  };

  const saveContactStatus = async (order, status) => {
    setContactStatus(status);
    const res = await fetch('/api/gardener/orders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: order.id, action: 'contact', contactStatus: status })
    });
    if (res.ok) fetchOrders();
    else alert((await res.json()).error);
  };

  const markPhoneClicked = (order) => {
    saveContactStatus(order, 'Позвонил');
  };

  const handlePhotoSelect = async (e, which) => {
    const files = Array.from(e.target.files || []);
    const file = files[0];
    if (!file) return;
    setUploadingWhich(which);
    try {
      const urls = [];
      for (const selectedFile of which === 'extra' ? files : [file]) {
        const compressed = await compressImage(selectedFile);
        const formData = new FormData();
        formData.append('image', compressed, 'photo.jpg');
        const res = await fetch('/api/gardener/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
        urls.push(data.url);
      }
      if (which === 'before') setPhotoBeforeUrl(urls[0]);
      if (which === 'after') setPhotoAfterUrl(urls[0]);
      if (which === 'act') setPhotoActUrl(urls[0]);
      if (which === 'extra') setExtraPhotoUrls(prev => [...prev, ...urls]);
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
      payload.extraPhotos = extraPhotoUrls;
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

  const addExpense = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/gardener/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...expenseForm, receiptUrl: expenseReceiptUrl }) });
    if (res.ok) { setExpenseForm({ date: new Date().toISOString().split('T')[0], amount: '', description: '' }); setExpenseReceiptUrl(''); fetchOrders(); }
    else alert((await res.json()).error);
  };

  const uploadExpenseReceipt = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('image', compressed, 'receipt.jpg');
      const res = await fetch('/api/gardener/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось загрузить чек');
      setExpenseReceiptUrl(data.url);
    } catch (error) {
      alert(error.message);
    } finally {
      e.target.value = '';
    }
  };

  const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', weekday: 'long'
  });

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
        {order.paymentType === 'Безнал' && (
          <div className="text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded px-2 py-1 mb-2">Безнал · оплачено фирме</div>
        )}

        <div className="space-y-2 text-sm text-slate-600">
          <div>📍 <span className="font-medium text-slate-800">{order.address}</span></div>
          {order.district && <div>🗺️ Район: <span className="font-medium text-slate-800">{order.district}</span></div>}
          <div>📞 <a href={`tel:${order.clientPhone}`} onClick={() => markPhoneClicked(order)} className="text-emerald-600 font-medium underline">{order.clientPhone}</a></div>
          {order.status === 'Новый заказ' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500">Связь с клиентом:</span>
              <select value={order.contactStatus || 'Не связывался'} onChange={e => saveContactStatus(order, e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-xs">
                <option>Не связывался</option>
                <option>Позвонил</option>
                <option>Связался</option>
                <option>Не ответил</option>
                <option>Перезвонить позже</option>
                <option>Неверный номер</option>
              </select>
            </div>
          )}
          {order.contactPenalty > 0 && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">Штраф: с клиентом не связались до 18:00 накануне заказа: {order.contactPenalty} ₽</div>}
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
  const orderShare = order => (order.priceFact || order.priceContract || 0) * ((order.companyShare || 0) / 100);
  const cashToCompany = orders.filter(o => o.status === 'Выполнен' && !o.paid && o.paymentType !== 'Безнал').reduce((sum, o) => sum + orderShare(o), 0);
  const cashlessToCompany = orders.filter(o => o.status === 'Выполнен' && !o.paid && o.paymentType === 'Безнал').reduce((sum, o) => sum + orderShare(o), 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const totalPenalties = orders.reduce((sum, order) => sum + (order.contactPenalty || 0), 0);
  const walletBalance = cashToCompany - cashlessToCompany - totalExpenses + totalPenalties;

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

        <div className="flex gap-2 mb-4">
          <button onClick={() => setActiveSection('orders')} className={`px-3 py-2 rounded-lg text-sm font-medium ${activeSection === 'orders' ? 'bg-emerald-600 text-white' : 'bg-white border text-slate-600'}`}>Заказы</button>
          <button onClick={() => setActiveSection('expenses')} className={`px-3 py-2 rounded-lg text-sm font-medium ${activeSection === 'expenses' ? 'bg-emerald-600 text-white' : 'bg-white border text-slate-600'}`}>Траты</button>
          <button onClick={() => setActiveSection('wallet')} className={`px-3 py-2 rounded-lg text-sm font-medium ${activeSection === 'wallet' ? 'bg-emerald-600 text-white' : 'bg-white border text-slate-600'}`}>Кошелек</button>
        </div>

        {activeSection === 'wallet' ? (
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <h3 className="font-semibold text-slate-800">К сдаче фирме</h3>
            <div className="text-3xl font-bold text-emerald-800">{walletBalance} ₽</div>
            <div className="text-sm text-slate-500">Нал: +{cashToCompany} ₽ · Безнал: -{cashlessToCompany} ₽ · Траты: -{totalExpenses} ₽ · Штрафы: +{totalPenalties} ₽</div>
          </div>
        ) : activeSection === 'expenses' ? (
          <div className="space-y-4">
            <form onSubmit={addExpense} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="font-semibold text-slate-800">Добавить трату</h3>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" required value={expenseForm.date} onChange={e => setExpenseForm({ ...expenseForm, date: e.target.value })} className="border rounded-lg p-2 text-sm" />
                <input type="number" required min="1" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} placeholder="Сумма, ₽" className="border rounded-lg p-2 text-sm" />
              </div>
              <textarea required value={expenseForm.description} onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })} placeholder="На что потрачено" className="w-full border rounded-lg p-2 text-sm" />
              <label className="flex items-center gap-2 border border-dashed rounded-lg p-2 text-sm text-slate-500 cursor-pointer">
                {expenseReceiptUrl ? 'Чек загружен ✓' : '📷 Сфотографировать чек'}
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={uploadExpenseReceipt} />
              </label>
              <button className="bg-emerald-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Сохранить трату</button>
            </form>
            <div className="bg-white rounded-xl border border-slate-200 divide-y">
              {expenses.map(expense => <div key={expense.id} className="p-3 flex justify-between gap-3"><div><div className="font-medium">{expense.description}</div><div className="text-xs text-slate-500">{new Date(expense.date).toLocaleDateString('ru-RU')}</div></div><b className="text-rose-700">-{expense.amount} ₽</b></div>)}
              {expenses.length === 0 && <p className="p-4 text-sm text-slate-400">Трат пока нет.</p>}
            </div>
          </div>
        ) : (
        loading ? (
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
                      <span className="font-medium text-slate-700">{d}</span>
                      {dayOrders.length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
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
        ))}
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
                        <label className="flex items-center justify-center gap-2 border border-dashed border-slate-300 rounded-lg p-3 text-sm text-slate-500 cursor-pointer hover:bg-slate-50">
                          {uploadingWhich === key ? 'Загружаю...' : '📷 Выбрать фото'}
                          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handlePhotoSelect(e, key)} disabled={uploadingWhich === key} />
                        </label>
                      )}
                    </div>
                  ))}
                  <label className="flex items-center justify-center gap-2 border border-dashed border-slate-300 rounded-lg p-3 text-sm text-slate-500 cursor-pointer hover:bg-slate-50">
                    📷 Дополнительные фото ({extraPhotoUrls.length})
                    <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => handlePhotoSelect(e, 'extra')} />
                  </label>

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
