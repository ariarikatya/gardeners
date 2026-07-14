'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function GardenerDashboard() {
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-emerald-800 text-white py-4 px-4 flex justify-between items-center shadow">
        <h1 className="text-lg font-bold flex items-center gap-1">🌿 Мой Кабинет</h1>
        <button onClick={handleLogout} className="text-xs bg-emerald-700 px-3 py-1.5 rounded-lg">Выйти</button>
      </header>

      <main className="p-4 max-w-md mx-auto">
        <h2 className="text-xl font-bold text-emerald-900 mb-4">Мои заказы</h2>

        {loading ? (
          <div className="text-center text-slate-500 py-8">Загрузка...</div>
        ) : orders.length === 0 ? (
          <div className="text-center text-slate-500 py-8 bg-white border rounded-xl">У вас пока нет назначенных заказов</div>
        ) : (
          <div className="space-y-4">
            {orders.map(order => {
              const formattedDate = new Date(order.date).toLocaleDateString('ru-RU', {
                day: 'numeric', month: 'long', weekday: 'long'
              });
              return (
                <div key={order.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 relative overflow-hidden">
                  <div className={`absolute left-0 top-0 bottom-0 w-2 ${order.status === 'Выполнен' ? 'bg-slate-300' : 'bg-emerald-500'}`}></div>
                  <div className="pl-2">
                    <div className="text-xs font-semibold text-emerald-700 capitalize mb-1">{formattedDate}</div>
                    <div className="text-lg font-bold text-slate-900 mb-2">{order.clientName}</div>
                    
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
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
