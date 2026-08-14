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
    setSavingId(gardener.id);
    try {
      const res = await fetch('/api/leader', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: gardener.id,
          bonusPercent: Number(gardener.bonusPercent || 0),
          finePercent: Number(gardener.finePercent || 0),
          writeoffPercent: Number(gardener.writeoffPercent || 0),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка сохранения');
      await fetchData();
      alert('Параметры садавника сохранены');
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
                      <th className="px-3 py-2 font-semibold">Премия %</th>
                      <th className="px-3 py-2 font-semibold">Штраф %</th>
                      <th className="px-3 py-2 font-semibold">Списание %</th>
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
                            step="0.1"
                            value={g.bonusPercent}
                            onChange={(e) => updateGardenerField(g.id, 'bonusPercent', e.target.value)}
                            className="w-20 border border-slate-300 rounded-lg px-2 py-1.5"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={g.finePercent}
                            onChange={(e) => updateGardenerField(g.id, 'finePercent', e.target.value)}
                            className="w-20 border border-slate-300 rounded-lg px-2 py-1.5"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={g.writeoffPercent}
                            onChange={(e) => updateGardenerField(g.id, 'writeoffPercent', e.target.value)}
                            className="w-20 border border-slate-300 rounded-lg px-2 py-1.5"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <button
                            onClick={() => saveGardenerSettings(g)}
                            disabled={savingId === g.id}
                            className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-medium disabled:bg-emerald-400"
                          >
                            {savingId === g.id ? 'Сохраняю...' : 'Сохранить'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
