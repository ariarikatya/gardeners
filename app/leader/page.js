'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

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

const OPERATION_TYPE_LABELS = {
  bonus: 'Премия',
  fine: 'Штраф',
  writeoff: 'Списание',
  expense: 'Трата',
};

const PAYMENT_TARGET_LABELS = {
  GARDENER: 'Выплачено садовнику',
  COMPANY: 'Садовник оплатил фирме',
};

const normalizePaidTargets = (paidTo) => {
  if (!paidTo) return [];
  const raw = Array.isArray(paidTo) ? paidTo : String(paidTo).split(',');
  return raw
    .map((value) => String(value).trim())
    .filter((value) => value === 'GARDENER' || value === 'COMPANY');
};

const getOperationTypeLabel = (type) => OPERATION_TYPE_LABELS[type] || type || 'Операция';
const getPaymentTargetLabel = (paidTo, paid) => {
  const targets = normalizePaidTargets(paidTo);
  if (targets.length > 0) {
    return targets.map((target) => PAYMENT_TARGET_LABELS[target]).join(' + ');
  }
  if (paid) return 'Выплачено садовнику';
  return 'Не выплачено';
};

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
  const [leaderScale, setLeaderScale] = useState(1);
  const [leaderTab, setLeaderTab] = useState('finance');

  const summary = useMemo(() => {
    const revenue = Number(data.totals?.revenue || 0);
    const approvedExpenses = Number(data.totals?.approvedExpenses || 0);
    const companyShare = Number(data.totals?.companyShare || 0);
    const salary = Number(data.totals?.salary || 0);
    const forecast = Number(data.totals?.forecastRevenue || 0);
    const payout = Number(data.totals?.payout || 0);
    const estimated = Number(data.totals?.estimated || 0);
    return {
      revenue,
      approvedExpenses,
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
      if (!res.ok) {
        const errorText = await res.text();
        let errorJson;
        try { errorJson = JSON.parse(errorText); } catch (e) {}
        throw new Error((errorJson && errorJson.error) || `Ошибка сервера (${res.status}): ${errorText.slice(0, 100)}`);
      }
      const json = await res.json();
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
    setSavingId(gardener.id);
    try {
      const opsToCreate = [];
      if (Number(gardener.bonusDraft || 0) > 0) opsToCreate.push({ type: 'bonus', amount: Number(gardener.bonusDraft), description: (gardener.bonusNote || '').trim() || 'Премия' });
      if (Number(gardener.fineDraft || 0) > 0) opsToCreate.push({ type: 'fine', amount: Number(gardener.fineDraft), description: (gardener.fineNote || '').trim() || 'Штраф' });
      if (Number(gardener.writeoffDraft || 0) > 0) opsToCreate.push({ type: 'writeoff', amount: Number(gardener.writeoffDraft), description: (gardener.writeoffNote || '').trim() || 'Списание' });

      if (opsToCreate.length === 0) {
        alert('Задайте сумму для премии, штрафа или списания');
        return;
      }

      for (const op of opsToCreate) {
        const res = await fetch('/api/leader/operations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gardenerId: gardener.id, type: op.type, amount: op.amount, description: op.description })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Ошибка создания операции');
      }

      setData((prev) => ({
        ...prev,
        gardeners: prev.gardeners.map((g) => g.id === gardener.id ? {
          ...g,
          bonusDraft: '',
          fineDraft: '',
          writeoffDraft: '',
          bonusNote: '',
          fineNote: '',
          writeoffNote: '',
        } : g),
      }));
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
    const nextValue = Array.isArray(paidTo) ? paidTo : (paidTo ? [paidTo] : []);
    const previousOrder = ordersList.find((o) => o.id === orderId);
    const nextSerialized = nextValue.length > 0 ? nextValue.join(',') : null;

    // Optimistically update orders list (checkbox state)
    setOrdersList((prev) => prev.map((o) => o.id === orderId ? { ...o, paid: nextValue.length > 0, paidTo: nextSerialized } : o));

    // Prepare a snapshot to allow revert on error
    const prevDataSnapshot = data;

    // Optimistically update dashboard totals and gardener row to avoid full refetch/flicker
    if (previousOrder && previousOrder.status === 'Выполнен') {
      const orderAmount = Number(previousOrder.priceFact || previousOrder.priceContract || 0);
      const prevTargets = normalizePaidTargets(previousOrder.paidTo);
      if (prevTargets.length === 0 && previousOrder.paid) prevTargets.push('GARDENER');
      const nextTargets = nextValue;

      setData((prev) => {
        if (!prev || !prev.gardeners) return prev;
        let deltaTotal = 0;
        const gardeners = prev.gardeners.map((g) => {
          if (g.id !== previousOrder.gardenerId) return g;
          const oldPayout = Number(g.payout || 0);
          let newPayout = oldPayout;

          // If gardener payment was removed -> payout increases by orderAmount
          if (prevTargets.includes('GARDENER') && !nextTargets.includes('GARDENER')) newPayout += orderAmount;
          // If gardener payment was added -> payout decreases by orderAmount
          if (!prevTargets.includes('GARDENER') && nextTargets.includes('GARDENER')) newPayout -= orderAmount;

          // Company target affects payout similarly
          if (prevTargets.includes('COMPANY') && !nextTargets.includes('COMPANY')) newPayout += orderAmount;
          if (!prevTargets.includes('COMPANY') && nextTargets.includes('COMPANY')) newPayout -= orderAmount;

          deltaTotal = newPayout - oldPayout;
          return { ...g, payout: newPayout };
        });

        const totals = { ...(prev.totals || {}) };
        totals.payout = Number(totals.payout || 0) + deltaTotal;
        return { ...prev, gardeners, totals };
      });
    }

    try {
      const res = await fetch('/api/leader/order-paid', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderId, paidTo: nextSerialized })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка');
      // success - keep optimistic state. No full refetch to avoid flicker.
    } catch (err) {
      // revert optimistic updates
      if (previousOrder) {
        setOrdersList((prev) => prev.map((o) => o.id === orderId ? previousOrder : o));
        setData(prevDataSnapshot);
      }
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
          <Link href="/admin/users" className="bg-amber-600 hover:bg-amber-500 text-white font-medium px-3 py-2 rounded-lg text-sm transition-all">
            👥 Пользователи
          </Link>
          <button onClick={handleLogout} className="bg-emerald-700 hover:bg-emerald-600 px-3 py-2 rounded-lg text-sm">Выйти</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-2 sm:px-3 py-3 space-y-3">
        <div className="flex gap-2 border-b border-slate-200 pb-2">
          <button
            onClick={() => setLeaderTab('finance')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${leaderTab === 'finance' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white border text-slate-700 hover:bg-slate-50'}`}
          >
            💰 Финансы и Заказы
          </button>
          <button
            onClick={() => setLeaderTab('catalog')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${leaderTab === 'catalog' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white border text-slate-700 hover:bg-slate-50'}`}
          >
            📦 Справочная база и назначение
          </button>
        </div>

        {leaderTab === 'catalog' ? (
          <CatalogLeaderSection gardeners={data.gardeners || []} onRefresh={fetchData} />
        ) : (
        <>
        <div className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-wrap gap-3 items-end">
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
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-700">
            <span>Масштаб {Math.round(leaderScale * 100)}%</span>
            <button onClick={() => setLeaderScale(s => Math.max(0.7, +(s - 0.1).toFixed(1)))} className="bg-white border rounded px-2 py-1">−</button>
            <button onClick={() => setLeaderScale(s => Math.min(1, +(s + 0.1).toFixed(1)))} className="bg-white border rounded px-2 py-1">+</button>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">Загрузка данных...</div>
        ) : (
          <>
            <div style={{ fontSize: `${leaderScale}em` }} className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Заказы</div>
                <div className="text-3xl font-bold text-slate-900 mt-2">{data.totals?.orders || 0}</div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Выручка</div>
                <div className="text-3xl font-bold text-emerald-700 mt-2">{formatMoney(summary.revenue)}</div>
                <div className="text-[11px] text-slate-500 mt-1">Одобренные траты фирмы: −{formatMoney(summary.approvedExpenses)}</div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Долг садовников фирме</div>
                <div className="text-2xl font-bold text-rose-700 mt-2">{formatMoney(summary.companyShare)}</div>
                <div className="text-[11px] text-slate-500 mt-1">Считается по долям фирмы, штрафам и списаниям по заказам.</div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">К выплате</div>
                <div className="text-2xl font-bold text-violet-700 mt-2">{formatMoney(summary.payout)}</div>
                <div className="text-[11px] text-slate-500 mt-1">Заработано + премии − штрафы − списания − долг садовника фирме.</div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Прогноз продаж</div>
                <div className="text-2xl font-bold text-blue-700 mt-2">{formatMoney(summary.forecast)}</div>
                <div className="text-[11px] text-slate-500 mt-1">Считается по планируемым заказам за вычетом процента садовника.</div>
              </div>
            </div>
 
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-3 text-xs text-slate-600">
              Как считается кошелёк: выручка фирмы = выполненные заказы − одобренные траты; «К выплате» = заработано + премии − штрафы − списания − долг садовников фирме.
            </div>
 
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-2">
              <h2 className="text-base font-bold text-slate-800 mb-1 flex items-center gap-2">По садовникам {Number(data.totals?.pendingExpenses || 0) > 0 && <span className="text-[11px] bg-amber-100 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">Новых трат: {data.totals.pendingExpenses}</span>}</h2>
              <div className="overflow-x-auto">
                <div style={{ width: `${100 / leaderScale}%`, transform: `scale(${leaderScale})`, transformOrigin: '0 0' }}>
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-left">
                      <th className="px-2 py-1.5 font-semibold">Садовник</th>
                      <th className="px-2 py-1.5 font-semibold">Заказы</th>
                      <th className="px-2 py-1.5 font-semibold">Заработано</th>
                      <th className="px-2 py-1.5 font-semibold">Долг фирме</th>
                      <th className="px-2 py-1.5 font-semibold">Начислено</th>
                      <th className="px-2 py-1.5 font-semibold">К выплате</th>
                      <th className="px-2 py-1.5 font-semibold">Премия ₽</th>
                      <th className="px-2 py-1.5 font-semibold">Штраф ₽</th>
                      <th className="px-2 py-1.5 font-semibold">Списание ₽</th>
                      <th className="px-2 py-1.5 font-semibold">% фирмы</th>
                      <th className="px-2 py-1.5 font-semibold">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.gardeners || []).map((g) => (
                      <tr key={g.id} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-2">
                          <div className="font-semibold text-slate-800">{g.name}</div>
                          <div className="text-xs text-slate-500">{g.phone}</div>
                        </td>
                        <td className="px-2 py-2">{g.totalOrders}</td>
                        <td className="px-2 py-2 text-emerald-700 font-semibold">{formatMoney(g.revenue)}</td>
                        <td className="px-2 py-2 text-rose-700 font-semibold">{formatMoney(g.share)}</td>
                        <td className="px-2 py-2 text-violet-700 font-semibold">{formatMoney(g.estimated)}</td>
                        <td className="px-2 py-2 text-sky-700 font-bold">{formatMoney(g.payout)}</td>
                        
                        {/* Колонка Премия */}
                        <td className="px-2 py-2">
                          <div className="text-[10px] uppercase text-slate-400 mb-1">Итого: {formatMoney(g.bonus)}</div>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={g.bonusDraft ?? ''}
                            onChange={(e) => updateGardenerField(g.id, 'bonusDraft', e.target.value)}
                            className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 mb-2"
                            placeholder="Добавить"
                          />
                          <input
                            type="text"
                            value={g.bonusNote ?? ''}
                            onChange={(e) => updateGardenerField(g.id, 'bonusNote', e.target.value)}
                            className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
                            placeholder="Причина"
                          />
                        </td>

                        {/* Колонка Штраф */}
                        <td className="px-2 py-2">
                          <div className="text-[10px] uppercase text-slate-400 mb-1">Итого: {formatMoney(g.fine)}</div>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={g.fineDraft ?? ''}
                            onChange={(e) => updateGardenerField(g.id, 'fineDraft', e.target.value)}
                            className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 mb-2"
                            placeholder="Добавить"
                          />
                          <input
                            type="text"
                            value={g.fineNote ?? ''}
                            onChange={(e) => updateGardenerField(g.id, 'fineNote', e.target.value)}
                            className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
                            placeholder="Причина"
                          />
                        </td>

                        {/* Колонка Списание */}
                        <td className="px-2 py-2">
                          <div className="text-[10px] uppercase text-slate-400 mb-1">Итого: {formatMoney(g.writeoff)}</div>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={g.writeoffDraft ?? ''}
                            onChange={(e) => updateGardenerField(g.id, 'writeoffDraft', e.target.value)}
                            className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 mb-2"
                            placeholder="Добавить"
                          />
                          <input
                            type="text"
                            value={g.writeoffNote ?? ''}
                            onChange={(e) => updateGardenerField(g.id, 'writeoffNote', e.target.value)}
                            className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
                            placeholder="Причина"
                          />
                        </td>

                        {/* Колонка Доля фирмы % (Новая) */}
                        <td className="px-2 py-2">
                          <div className="text-[10px] uppercase text-slate-400 mb-1">Доля фирмы %</div>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={g.bonusPercent ?? g.bonusPercent === 0 ? g.bonusPercent : ''}
                            onChange={(e) => updateGardenerField(g.id, 'bonusPercent', Number(e.target.value))}
                            className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 mb-2"
                            placeholder="%"
                          />
                          <button 
                            onClick={async () => {
                              try {
                                const res = await fetch('/api/leader', { 
                                  method: 'PUT', 
                                  headers: { 'Content-Type': 'application/json' }, 
                                  body: JSON.stringify({ 
                                    id: g.id, 
                                    bonusPercent: g.bonusPercent, 
                                    finePercent: g.finePercent, 
                                    writeoffPercent: g.writeoffPercent 
                                  }) 
                                });
                                if (!res.ok) throw new Error((await res.json()).error || 'Ошибка');
                                await fetchData();
                                alert('Процент сохранён');
                              } catch (err) { 
                                alert(err.message || 'Ошибка'); 
                              }
                            }} 
                            className="text-xs bg-emerald-600 text-white px-2 py-1 rounded"
                          >
                            Сохранить %
                          </button>
                        </td>

                        {/* Колонка Действия */}
                        <td className="px-2 py-2">
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
                            >Операции {Number(g.pendingExpenses || 0) > 0 && <span title="Новые траты" className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[10px]">{g.pendingExpenses}</span>}</button>
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
                      <div className="flex-1">
                        <div className="text-sm font-medium">{getOperationTypeLabel(op.type)} — {formatMoney(op.amount)} {op.type === 'expense' && (op.approved ? <span className="text-[11px] ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded">Утверждён{op.approvedAmount && op.approvedAmount !== op.amount ? `: ${formatMoney(op.approvedAmount)}` : ''}</span> : <span className="text-[11px] ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 rounded">Новая</span>)}</div>
                        {op.description && <div className="text-xs text-slate-500">{op.description}</div>}
                        <div className="text-xs text-slate-400">{new Date(op.createdAt).toLocaleString('ru-RU')}</div>
                        {op.receiptUrl && <a href={op.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-1"><img src={op.receiptUrl} alt="Чек" className="w-20 h-20 object-cover rounded border border-slate-200" /></a>}
                      </div>

                      {op.type === 'expense' && <div className="flex items-center gap-2">
                        <input type="number" defaultValue={op.approvedAmount ?? op.amount} min="0" className="w-24 border rounded px-2 py-1 text-sm" id={`approved-${op.id}`} />
                        <button
                          onClick={async () => {
                            const el = document.getElementById(`approved-${op.id}`);
                            const val = el ? Number(el.value || 0) : Number(op.amount || 0);
                            try {
                              const res = await fetch('/api/leader/operations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: op.id, approved: true, approvedAmount: val }) });
                              const json = await res.json();
                              if (!res.ok) throw new Error(json.error || 'Ошибка');
                              // обновим список
                              if (opsModalGardener) await openOpsModal(opsModalGardener);
                              await fetchData();
                              // если бот вк настроен, можно показать уведомление в UI
                              if (json.operation && json.operation.approved) alert('Трата утверждена и садовник должен получить уведомление во ВКонтакте (если указан vkId)');
                            } catch (err) { alert(err.message || 'Ошибка'); }
                          }}
                          className="bg-emerald-600 text-white px-3 py-1 rounded text-sm"
                        >Утвердить</button>

                        <button
                          onClick={async () => {
                            // снять утверждение
                            try {
                              const res = await fetch('/api/leader/operations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: op.id, approved: false, approvedAmount: null }) });
                              const json = await res.json();
                              if (!res.ok) throw new Error(json.error || 'Ошибка');
                              if (opsModalGardener) await openOpsModal(opsModalGardener);
                              await fetchData();
                            } catch (err) { alert(err.message || 'Ошибка'); }
                          }}
                          className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-sm"
                        >Снять</button>

                        <button onClick={() => deleteOperation(op.id)} className="text-rose-600 text-xs">Удалить</button>
                      </div>}
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
                  {ordersList.map(o => {
                    const selectedTargets = normalizePaidTargets(o.paidTo);
                    const toggleTarget = (target, checked) => {
                      const nextTargets = checked
                        ? Array.from(new Set([...selectedTargets, target]))
                        : selectedTargets.filter((item) => item !== target);
                      toggleOrderPaid(o.id, nextTargets);
                    };

                    return (
                      <li key={o.id} className="border p-3 rounded-lg">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="text-sm font-medium">{new Date(o.date).toLocaleDateString('ru-RU')} — {o.clientName} — {o.status}</div>
                            {o.address && <div className="text-xs text-slate-600 mt-0.5">📍 <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(o.district ? `${o.district}, ${o.address}` : o.address)}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline font-medium">{o.district ? `${o.district} • ${o.address}` : o.address}</a></div>}
                            {o.refusalReason && <div className="text-xs text-rose-600 font-medium mt-0.5">Причина отказа: {o.refusalReason}</div>}
                            <div className="text-xs text-slate-500 mt-1">Сумма: {Number(o.priceFact || o.priceContract || 0).toLocaleString('ru-RU')} ₽</div>
                            <div className="text-xs text-slate-500 mt-1">Текущий статус: {getPaymentTargetLabel(o.paidTo, o.paid)}</div>
                          </div>
                          <div className="flex flex-col gap-2 sm:mt-0">
                            <span className="text-[11px] uppercase tracking-wide text-slate-500">Выплата</span>
                            <label className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={selectedTargets.includes('GARDENER')}
                                onChange={(e) => toggleTarget('GARDENER', e.target.checked)}
                              />
                              {PAYMENT_TARGET_LABELS.GARDENER}
                            </label>
                            <label className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={selectedTargets.includes('COMPANY')}
                                onChange={(e) => toggleTarget('COMPANY', e.target.checked)}
                              />
                              {PAYMENT_TARGET_LABELS.COMPANY}
                            </label>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
        </>
        )}
      </main>
    </div>
  );
}

function CatalogLeaderSection({ gardeners, onRefresh }) {
  const [catalogType, setCatalogType] = useState('inventory');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [image, setImage] = useState('');
  const [uploading, setUploading] = useState(false);

  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const [selectedGardenerIds, setSelectedGardenerIds] = useState([]);
  const [assigning, setAssigning] = useState(false);

  const loadCatalog = async () => {
    try {
      const res = await fetch('/api/catalog');
      if (res.ok) {
        const data = await res.json();
        setItems(catalogType === 'inventory' ? data.inventoryItems || [] : data.preparationItems || []);
      }
    } catch (e) {}
  };

  useEffect(() => {
    loadCatalog();
    setSelectedItemIds([]);
  }, [catalogType]);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploading(true);
    try {
      const file = files[0];
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
        setImage(data.url);
      } else {
        alert(data.error || 'Ошибка загрузки фото');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка при загрузке изображения');
    } finally {
      setUploading(false);
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: catalogType, name: name.trim(), description: desc.trim(), image: image || null }),
      });
      if (res.ok) {
        setName('');
        setDesc('');
        setImage('');
        loadCatalog();
      } else {
        alert((await res.json()).error || 'Ошибка');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (id) => {
    if (!confirm('Удалить из справочника?')) return;
    const res = await fetch('/api/catalog', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: catalogType, id }),
    });
    if (res.ok) loadCatalog();
  };

  const handleMassAssign = async (action = 'assign') => {
    if (selectedItemIds.length === 0) {
      alert('Выберите хотя бы одну позицию из справочника!');
      return;
    }
    if (selectedGardenerIds.length === 0) {
      alert('Выберите хотя бы одного сотрудника!');
      return;
    }

    setAssigning(true);
    try {
      const res = await fetch('/api/catalog/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: catalogType,
          itemIds: selectedItemIds,
          gardenerIds: selectedGardenerIds,
          action,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(action === 'unassign' ? `Снято назначение у ${data.count} сотрудников!` : `Успешно назначено ${data.count} сотрудникам!`);
        setSelectedItemIds([]);
        if (onRefresh) onRefresh();
      } else {
        alert(data.error || 'Ошибка');
      }
    } finally {
      setAssigning(false);
    }
  };

  const toggleAllGardeners = () => {
    if (selectedGardenerIds.length === gardeners.length) {
      setSelectedGardenerIds([]);
    } else {
      setSelectedGardenerIds(gardeners.map(g => g.id));
    }
  };

  const toggleAllItems = () => {
    if (selectedItemIds.length === items.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(items.map(i => i.id));
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6 shadow-sm">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Общий справочник баз и массовое назначение</h3>
          <p className="text-xs text-slate-500">Добавляйте позиции в базу и массово распределяйте их по сотрудникам в 1 клик</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCatalogType('inventory')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${catalogType === 'inventory' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700'}`}
          >
            🧰 Инвентарь
          </button>
          <button
            type="button"
            onClick={() => setCatalogType('preparation')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${catalogType === 'preparation' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700'}`}
          >
            🧪 Препараты
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleAddItem} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3 h-fit">
          <h4 className="text-xs font-bold text-slate-700 uppercase">+ Новая позиция в базу</h4>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Название *</label>
            <input
              type="text" required
              value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white"
              placeholder={catalogType === 'inventory' ? 'Например: Газонокосилка Honda' : 'Например: Бордоская смесь'}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Описание / характеристики</label>
            <input
              type="text"
              value={desc} onChange={e => setDesc(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white"
              placeholder="Характеристики или применение..."
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Фотография</label>
            <div className="flex items-center gap-2">
              {image ? (
                <div className="relative group flex-shrink-0">
                  <img src={image} alt="Превью" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                  <button
                    type="button"
                    onClick={() => setImage('')}
                    className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center shadow"
                    title="Удалить фото"
                  >
                    ✕
                  </button>
                </div>
              ) : null}
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                disabled={uploading}
                className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 disabled:opacity-50"
              />
            </div>
          </div>
          <button
            type="submit" disabled={loading || uploading}
            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Сохранение...' : uploading ? 'Загрузка фото...' : '+ Добавить в справочник'}
          </button>
        </form>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-700 uppercase">
              Справочник ({items.length})
            </h4>
            {items.length > 0 && (
              <button type="button" onClick={toggleAllItems} className="text-xs text-emerald-600 font-semibold hover:underline">
                {selectedItemIds.length === items.length ? 'Снять выделение' : 'Выбрать все позиции'}
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="text-xs text-slate-400 italic p-4 bg-slate-50 rounded-xl border">Справочник пуст</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto p-1 border rounded-xl">
              {items.map(it => {
                const isChecked = selectedItemIds.includes(it.id);
                return (
                  <div key={it.id} className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 text-xs ${isChecked ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-200'}`}>
                    <label className="flex items-center gap-3 cursor-pointer min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => setSelectedItemIds(prev => prev.includes(it.id) ? prev.filter(x => x !== it.id) : [...prev, it.id])}
                        className="rounded text-emerald-600 flex-shrink-0"
                      />
                      {it.image ? (
                        <img src={it.image} alt={it.name} className="w-12 h-12 object-cover rounded-lg border border-slate-200 flex-shrink-0" />
                      ) : (
                        <div className="w-12 h-12 bg-slate-200 rounded-lg flex items-center justify-center text-[9px] text-slate-400 flex-shrink-0 text-center px-1">
                          Без фото
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-800 truncate">{it.name}</div>
                        {it.description && <div className="text-[10px] text-slate-500 truncate">{it.description}</div>}
                      </div>
                    </label>
                    <button
                      type="button" onClick={() => handleDeleteItem(it.id)}
                      className="text-rose-500 hover:text-rose-700 font-bold px-1.5 py-0.5 rounded text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 uppercase">
                Массовое назначение сотрудникам ({selectedGardenerIds.length} выбрано)
              </h4>
              <button type="button" onClick={toggleAllGardeners} className="text-xs text-emerald-600 font-semibold hover:underline">
                {selectedGardenerIds.length === gardeners.length ? 'Снять выделение' : 'Выбрать всех сотрудников'}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 border border-slate-200 rounded-xl bg-slate-50">
              {gardeners.map(g => {
                const isSelected = selectedGardenerIds.includes(g.id);
                return (
                  <label key={g.id} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer select-none ${isSelected ? 'bg-emerald-100 border-emerald-400 text-emerald-900 font-medium' : 'bg-white border-slate-200 text-slate-700'}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => setSelectedGardenerIds(prev => prev.includes(g.id) ? prev.filter(x => x !== g.id) : [...prev, g.id])}
                      className="rounded text-emerald-600"
                    />
                    <span>{g.name}</span>
                  </label>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleMassAssign('assign')}
                disabled={assigning || selectedItemIds.length === 0 || selectedGardenerIds.length === 0}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
              >
                {assigning ? 'Назначение...' : `🚀 Назначить (${selectedItemIds.length} поз. → ${selectedGardenerIds.length} сотр.)`}
              </button>
              <button
                type="button"
                onClick={() => handleMassAssign('unassign')}
                disabled={assigning || selectedItemIds.length === 0 || selectedGardenerIds.length === 0}
                className="py-2.5 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 disabled:opacity-40 font-bold text-xs rounded-xl transition-all"
              >
                ✕ Снять
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
