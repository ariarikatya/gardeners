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

export default function GardenerDashboard() {
  const router = useRouter();
  const [orders, setOrders] = useState([]);
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
  };

  const closeAction = () => {
    setActionOrder(null);
    setActionType(null);
  };

  const submitAction = async (e) => {
    e.preventDefault();
    if (!actionOrder) return;
    setSubmitting(true);

    const payload = { id: actionOrder.id, action: actionType };
    if (actionType === 'transfer') payload.transferRequestedDate = transferDate;
    if (actionType === 'refuse') payload.refusalReason = refusalText;
    if (actionType === 'complete') payload.priceFact = factAmount;

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
          <div>📍 <span className="font-medium text-slate-800">{order.address}</span></div>
          <div>📞 <a href={`tel:${order.clientPhone}`} className="text-emerald-600 font-medium underline">{order.clientPhone}</a></div>
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
        <button onClick={handleLogout} className="text-xs bg-emerald-700 px-3 py-1.5 rounded-lg">Выйти</button>
      </header>

      <main className="p-4 max-w-md mx-auto">
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
          <div className="space-y-4">
            {orders.map(renderOrderCard)}
          </div>
        ) : (
          <div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 mb-4">
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
              <div className="space-y-4">
                {(ordersByDate[selectedDateStr] || []).length === 0 ? (
                  <p className="text-sm text-slate-400 text-center">В этот день заказов нет</p>
                ) : (
                  ordersByDate[selectedDateStr].map(renderOrderCard)
                )}
              </div>
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
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Фактическая сумма заказа, ₽</label>
                  <input
                    type="number" required min="1" step="1"
                    value={factAmount}
                    onChange={e => setFactAmount(e.target.value)}
                    className="mt-1 block w-full border border-slate-300 rounded-lg p-2"
                  />
                  <p className="text-xs text-slate-400 mt-2">Без указания суммы заказ нельзя закрыть как выполненный.</p>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={closeAction} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600">
                  Отмена
                </button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50">
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
