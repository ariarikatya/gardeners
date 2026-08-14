'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const currency = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });

function getDefaultRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function formatMoney(value) {
  return currency.format(Number(value || 0));
}

export default function LeaderDashboard() {
  const router = useRouter();
  const [range, setRange] = useState('month');
  const [startDate, setStartDate] = useState(getDefaultRange().start);
  const [endDate, setEndDate] = useState(getDefaultRange().end);
  const [data, setData] = useState({ totals: {}, gardeners: [] });
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [opsModalGardener, setOpsModalGardener] = useState(null);
  const [opsList, setOpsList] = useState([]);
  const [loadingOps, setLoadingOps] = useState(false);
  const [ordersModalGardener, setOrdersModalGardener] = useState(null);
  const [ordersList, setOrdersList] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const summary = useMemo(() => {
    const revenue = Number(data.totals?.revenue || 0);
    const companyShare = Number(data.totals?.companyShare || 0);
    const salary = Number(data.totals?.salary || 0);
    const forecast = Number(data.totals?.forecastRevenue || 0);
    const payout = Number(data.totals?.payout || 0);
    const estimated = Number(data.totals?.estimated || 0);
    return {
      revenue,
      companyShare,
      salary,
      forecast,
      payout,
      estimated,
    };
  }, [data]);

  const fetchData = async (nextStart = startDate, nextEnd = endDate) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextStart) params.set('start', nextStart);
      if (nextEnd) params.set('end', nextEnd);
      const res = await fetch(`/api/leader?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки');
      setData(json);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (range === 'month') {
      const current = getDefaultRange();
      setStartDate(current.start);
      setEndDate(current.end);
      fetchData(current.start, current.end);
      return;
    }
    if (range === 'quarter') {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));
      fetchData(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
      return;
    }
    if (range === 'year') {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31);
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));
      fetchData(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
      return;
    }
    fetchData(startDate, endDate);
  }, [range]);

  useEffect(() => {
    fetchData(startDate, endDate);
  }, [startDate, endDate]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const saveGardenerSettings = async (gardener) => {
    // Новая логика: если введены суммы премии/штрафа/списания — создать операции (начисления) для садовника
    setSavingId(gardener.id);
    try {
      const opsToCreate = [];
      if (Number(gardener.bonusAmount || 0) > 0) opsToCreate.push({ type: 'bonus', amount: Number(gardener.bonusAmount) });
      if (Number(gardener.fineAmount || 0) > 0) opsToCreate.push({ type: 'fine', amount: Number(gardener.fineAmount) });
      if (Number(gardener.writeoffAmount || 0) > 0) opsToCreate.push({ type: 'writeoff', amount: Number(gardener.writeoffAmount) });

      for (const op of opsToCreate) {
        const res = await fetch('/api/leader/operations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gardenerId: gardener.id, type: op.type, amount: op.amount })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Ошибка создания операции');
      }

      await fetchData();
      alert('Операции добавлены');
    } catch (error) {
      alert(error.message);
    } finally {
      setSavingId(null);
    }
  };

  const updateGardenerField = (id, field, value) => {
    setData((prev) => ({
      ...prev,
      gardeners: prev.gardeners.map((g) => g.id === id ? { ...g, [field]: value } : g),
    }));
  };

  const openOpsModal = async (gardenerId) => {
    setOpsModalGardener(gardenerId);
    setLoadingOps(true);
    try {
      const params = new URLSearchParams();
      params.set('gardenerId', gardenerId);
      const res = await fetch(`/api/leader/operations?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка');
      setOpsList(json.operations || []);
    } catch (err) {
      alert(err.message || 'Ошибка загрузки операций');
    } finally {
      setLoadingOps(false);
    }
  };

  const closeOpsModal = () => { setOpsModalGardener(null); setOpsList([]); };

  const deleteOperation = async (id) => {
    if (!confirm('Удалить операцию?')) return;
    try {
      const res = await fetch(`/api/leader/operations?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка удаления');
      // обновим список
      if (opsModalGardener) await openOpsModal(opsModalGardener);
      await fetchData();
    } catch (err) {
      alert(err.message || 'Ошибка удаления');
    }
  };

  const openOrdersModal = async (gardenerId) => {
    setOrdersModalGardener(gardenerId);
    setLoadingOrders(true);
    try {
      const params = new URLSearchParams();
      params.set('gardenerId', gardenerId);
      const res = await fetch(`/api/leader/orders?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка');
      setOrdersList(json.orders || []);
    } catch (err) {
      alert(err.message || 'Ошибка загрузки заказов');
    } finally {
      setLoadingOrders(false);
    }
  };

  const closeOrdersModal = () => { setOrdersModalGardener(null); setOrdersList([]); };

  const toggleOrderPaid = async (orderId, paidTo) => {
    try {
      const res = await fetch('/api/leader/order-paid', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderId, paidTo: paidTo || null })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка');
      // обновим список и данные
      if (ordersModalGardener) await openOrdersModal(ordersModalGardener);
      await fetchData();
    } catch (err) {
      alert(err.message || 'Ошибка изменения статуса выплаты');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="bg-emerald-900 text-white px-4 py-4 flex items-center justify-between shadow">
        <div>
          <h1 className="text-lg font-bold">🌿 Руководитель</h1>
          <p className="text-xs text-emerald-100">Статистика, прогнозы и распределение бонусов</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleLogout} className="bg-emerald-700 px-3 py-2 rounded-lg text-sm">Выйти</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Период</label>
            <div className="flex gap-2">
              {['month', 'quarter', 'year', 'custom'].map((type) => (
                <button
                  key={type}
                  onClick={() => setRange(type)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${range === type ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  {type === 'month' ? 'Месяц' : type === 'quarter' ? 'Квартал' : type === 'year' ? 'Год' : 'Свой'}
                </button>
              ))}
            </div>
          </div>

          {range === 'custom' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">От</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">До</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-2 text-sm" />
              </div>
            </>
          )}
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">Загрузка данных...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Заказы</div>
                <div className="text-3xl font-bold text-slate-900 mt-2">{data.totals?.orders || 0}</div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Выручка</div>
                <div className="text-3xl font-bold text-emerald-700 mt-2">{formatMoney(summary.revenue)}</div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Долг фирмы</div>
                <div className="text-2xl font-bold text-rose-700 mt-2">{formatMoney(summary.companyShare)}</div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">К выплате</div>
                <div className="text-2xl font-bold text-violet-700 mt-2">{formatMoney(summary.payout)}</div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Прогноз продаж</div>
                <div className="text-2xl font-bold text-blue-700 mt-2">{formatMoney(summary.forecast)}</div>
                <div className="text-[11px] text-slate-500 mt-1">Будет начислено: {formatMoney(summary.estimated)}</div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <h2 className="text-lg font-bold text-slate-800 mb-4">По садовникам</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-left">
                      <th className="px-3 py-2 font-semibold">Садовник</th>
                      <th className="px-3 py-2 font-semibold">Заказы</th>
                      <th className="px-3 py-2 font-semibold">Заработано</th>
                      <th className="px-3 py-2 font-semibold">Долг фирме</th>
                      <th className="px-3 py-2 font-semibold">Будет начислено</th>
                      <th className="px-3 py-2 font-semibold">Премия ₽</th>
                      <th className="px-3 py-2 font-semibold">Штраф ₽</th>
                      <th className="px-3 py-2 font-semibold">Списание ₽</th>
                      <th className="px-3 py-2 font-semibold">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.gardeners || []).map((g) => (
                      <tr key={g.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-800">{g.name}</div>
                          <div className="text-xs text-slate-500">{g.phone}</div>
                        </td>
                        <td className="px-3 py-3">{g.totalOrders}</td>
                        <td className="px-3 py-3 text-emerald-700 font-semibold">{formatMoney(g.revenue)}</td>
                        <td className="px-3 py-3 text-rose-700 font-semibold">{formatMoney(g.share)}</td>
                        <td className="px-3 py-3 text-violet-700 font-semibold">{formatMoney(g.estimated)}</td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={g.bonusAmount || ''}
                            onChange={(e) => updateGardenerField(g.id, 'bonusAmount', e.target.value)}
                            className="w-28 border border-slate-300 rounded-lg px-2 py-1.5"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={g.fineAmount || ''}
                            onChange={(e) => updateGardenerField(g.id, 'fineAmount', e.target.value)}
                            className="w-28 border border-slate-300 rounded-lg px-2 py-1.5"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={g.writeoffAmount || ''}
                            onChange={(e) => updateGardenerField(g.id, 'writeoffAmount', e.target.value)}
                            className="w-28 border border-slate-300 rounded-lg px-2 py-1.5"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => saveGardenerSettings(g)}
                              disabled={savingId === g.id}
                              className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-medium disabled:bg-emerald-400"
                            >
                              {savingId === g.id ? 'Сохраняю...' : 'Сохранить'}
                            </button>
                            <button
                              onClick={() => openOpsModal(g.id)}
                              className="bg-slate-100 text-slate-700 px-2 py-1 rounded-lg text-xs border border-slate-200 hover:bg-slate-200"
                            >Операции</button>
                            <button
                              onClick={() => openOrdersModal(g.id)}
                              className="bg-slate-100 text-slate-700 px-2 py-1 rounded-lg text-xs border border-slate-200 hover:bg-slate-200"
                            >Заказы</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {opsModalGardener && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-4 max-w-lg w-full">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold">Операции садовника</h3>
                <button onClick={closeOpsModal} className="text-slate-500">Закрыть</button>
              </div>
              {loadingOps ? (
                <div className="text-center text-slate-500 py-4">Загрузка...</div>
              ) : opsList.length === 0 ? (
                <div className="text-center text-slate-500 py-4">Операций нет</div>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-auto">
                  {opsList.map(op => (
                    <li key={op.id} className="flex justify-between items-center border p-2 rounded">
                      <div>
                        <div className="text-sm font-medium">{op.type} — {formatMoney(op.amount)}</div>
                        {op.description && <div className="text-xs text-slate-500">{op.description}</div>}
                        <div className="text-xs text-slate-400">{new Date(op.createdAt).toLocaleString('ru-RU')}</div>
                      </div>
                      <button onClick={() => deleteOperation(op.id)} className="text-rose-600 text-xs">Удалить</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {ordersModalGardener && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-4 max-w-2xl w-full">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold">Заказы садовника</h3>
                <button onClick={closeOrdersModal} className="text-slate-500">Закрыть</button>
              </div>
              {loadingOrders ? (
                <div className="text-center text-slate-500 py-4">Загрузка...</div>
              ) : ordersList.length === 0 ? (
                <div className="text-center text-slate-500 py-4">Заказов нет</div>
              ) : (
                <ul className="space-y-2 max-h-72 overflow-auto">
                  {ordersList.map(o => (
                    <li key={o.id} className="flex justify-between items-center border p-2 rounded">
                      <div>
                        <div className="text-sm font-medium">{new Date(o.date).toLocaleDateString('ru-RU')} — {o.clientName} — {o.status}</div>
                        <div className="text-xs text-slate-500">Сумма: {o.priceFact || o.priceContract} ₽</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm flex items-center gap-2">
                          <span className="text-xs">Статус выплаты:</span>
                          <select
                            value={o.paidTo || (o.paid ? 'GARDENER' : '')}
                            onChange={(e) => toggleOrderPaid(o.id, e.target.value === '' ? null : e.target.value)}
                            className="border border-slate-200 rounded px-2 py-1 text-sm"
                          >
                            <option value="">Не выплачено</option>
                            <option value="GARDENER">Выплачено садовнику</option>
                            <option value="COMPANY">Выплачено фирмой</option>
                          </select>
                        </label>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
