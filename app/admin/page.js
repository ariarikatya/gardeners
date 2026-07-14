'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('calendar');
  const [gardeners, setGardeners] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  // Состояния для форм
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState({ date: null, gardenerId: null });
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [formData, setFormData] = useState({
    clientName: '', clientPhone: '', address: '', description: '',
    priceContract: 0, priceFact: 0, employeeSalary: 0, companyShare: 0,
    status: 'Новый заказ', comment: ''
  });

  // Добавление садовника
  const [newGardener, setNewGardener] = useState({ name: '', phone: '' });

  // Генерация дат на 30 дней вперед
  const dates = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [resG, resO] = await Promise.all([
        fetch('/api/admin/gardeners'),
        fetch('/api/admin/orders')
      ]);
      const dataG = await resG.json();
      const dataO = await resO.json();
      setGardeners(dataG.gardeners || []);
      setOrders(dataO.orders || []);
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

  const openNewOrderModal = (dateStr, gardenerId) => {
    setSelectedOrder(null);
    setSelectedSlot({ date: dateStr, gardenerId });
    setFormData({
      clientName: '', clientPhone: '', address: '', description: '',
      priceContract: 0, priceFact: 0, employeeSalary: 0, companyShare: 0,
      status: 'Новый заказ', comment: ''
    });
    setShowOrderModal(true);
  };

  const openEditOrderModal = (order) => {
    setSelectedOrder(order);
    setFormData({
      clientName: order.clientName,
      clientPhone: order.clientPhone,
      address: order.address,
      description: order.description,
      priceContract: order.priceContract,
      priceFact: order.priceFact,
      employeeSalary: order.employeeSalary,
      companyShare: order.companyShare,
      status: order.status,
      comment: order.comment || ''
    });
    setShowOrderModal(true);
  };

  const handleSaveOrder = async (e) => {
    e.preventDefault();
    const endpoint = '/api/admin/orders';
    const method = selectedOrder ? 'PUT' : 'POST';
    const payload = selectedOrder 
      ? { id: selectedOrder.id, ...formData }
      : { date: selectedSlot.date, gardenerId: selectedSlot.gardenerId, ...formData };

    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      setShowOrderModal(false);
      fetchData();
    } else {
      const data = await res.json();
      alert(data.error);
    }
  };

  const handleAddGardener = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/admin/gardeners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newGardener)
    });
    if (res.ok) {
      setNewGardener({ name: '', phone: '' });
      fetchData();
    } else {
      const data = await res.json();
      alert(data.error);
    }
  };

  const handleDeleteGardener = async (id) => {
    if (!confirm('Удалить этого садовника и его личный кабинет?')) return;
    const res = await fetch('/api/admin/gardeners', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) fetchData();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Шапка */}
      <header className="bg-emerald-900 text-white py-4 px-6 flex justify-between items-center shadow-md">
        <h1 className="text-xl font-bold flex items-center gap-2">
          🌲 Анемон Агро — Панель Диспетчера
        </h1>
        <button onClick={handleLogout} className="bg-emerald-700 hover:bg-emerald-600 px-4 py-2 rounded-lg text-sm">
          Выйти
        </button>
      </header>

      {/* Меню вкладок */}
      <div className="bg-white border-b border-slate-200 flex px-6 py-2 gap-4">
        <button 
          onClick={() => setActiveTab('calendar')}
          className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'calendar' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          📅 Календарь загрузки
        </button>
        <button 
          onClick={() => setActiveTab('gardeners')}
          className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'gardeners' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          🧑‍🌾 Садовники
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500">Загрузка данных...</div>
      ) : (
        <main className="p-6">
          {activeTab === 'calendar' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200">
                    <th className="p-3 text-left font-semibold text-slate-600 border-r border-slate-200 w-44">Дата / День</th>
                    {gardeners.map(g => (
                      <th key={g.id} className="p-3 text-center font-semibold text-slate-600 border-r border-slate-200 min-w-44">
                        {g.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dates.map(date => {
                    const dateStr = date.toISOString().split('T')[0];
                    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
                    const dayLabel = days[date.getDay()];
                    
                    return (
                      <tr key={dateStr} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="p-3 font-medium text-slate-700 border-r border-slate-200 bg-slate-50">
                          {dateStr} ({dayLabel})
                        </td>
                        {gardeners.map(g => {
                          const order = orders.find(o => o.gardenerId === g.id && o.date.startsWith(dateStr));
                          return (
                            <td key={g.id} className="p-2 border-r border-slate-200 text-center text-sm">
                              {order ? (
                                <div 
                                  onClick={() => openEditOrderModal(order)}
                                  className={`p-2 rounded-lg text-white font-medium cursor-pointer transition-all ${
                                    order.status === 'Выполнен' ? 'bg-slate-400 hover:bg-slate-500' : 'bg-red-500 hover:bg-red-600'
                                  }`}
                                >
                                  {order.clientName}
                                  <div className="text-xs opacity-90">{order.address}</div>
                                </div>
                              ) : (
                                <button 
                                  onClick={() => openNewOrderModal(dateStr, g.id)}
                                  className="w-full py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg font-medium border border-dashed border-emerald-300 transition-all"
                                >
                                  Свободно
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'gardeners' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Список */}
              <div className="col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-lg font-bold text-slate-700 mb-4">Наши садовники ({gardeners.length})</h3>
                <div className="divide-y divide-slate-100">
                  {gardeners.map(g => (
                    <div key={g.id} className="py-3 flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-slate-800">{g.name}</div>
                        <div className="text-slate-500 text-sm">Телефон: {g.phone}</div>
                      </div>
                      <button 
                        onClick={() => handleDeleteGardener(g.id)}
                        className="text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm transition-all"
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Добавление нового */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-fit">
                <h3 className="text-lg font-bold text-slate-700 mb-4">Добавить нового</h3>
                <form onSubmit={handleAddGardener} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600">ФИО Садовника</label>
                    <input 
                      type="text" required 
                      value={newGardener.name}
                      onChange={e => setNewGardener({...newGardener, name: e.target.value})}
                      className="mt-1 block w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600">Телефон для авторизации</label>
                    <input 
                      type="text" required placeholder="79991234567"
                      value={newGardener.phone}
                      onChange={e => setNewGardener({...newGardener, phone: e.target.value})}
                      className="mt-1 block w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <button type="submit" className="w-full bg-emerald-600 text-white py-2 rounded-lg font-medium hover:bg-emerald-700">
                    Добавить садовника
                  </button>
                </form>
              </div>
            </div>
          )}
        </main>
      )}

      {/* Модальное окно заказа */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-xl">
            <h3 className="text-xl font-bold text-slate-800 mb-4">
              {selectedOrder ? 'Редактировать заказ' : `Новая запись на ${selectedSlot.date}`}
            </h3>
            <form onSubmit={handleSaveOrder} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">ФИО Клиента</label>
                  <input type="text" required value={formData.clientName} onChange={e => setFormData({...formData, clientName: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Телефон Клиента</label>
                  <input type="text" required value={formData.clientPhone} onChange={e => setFormData({...formData, clientPhone: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Адрес</label>
                <input type="text" required value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Описание работ (Что делать)</label>
                <textarea required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Сумма по договору</label>
                  <input type="number" value={formData.priceContract} onChange={e => setFormData({...formData, priceContract: parseFloat(e.target.value) || 0})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Сумма по факту</label>
                  <input type="number" value={formData.priceFact} onChange={e => setFormData({...formData, priceFact: parseFloat(e.target.value) || 0})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">ЗП сотрудника</label>
                  <input type="number" value={formData.employeeSalary} onChange={e => setFormData({...formData, employeeSalary: parseFloat(e.target.value) || 0})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Доля фирмы</label>
                  <input type="number" value={formData.companyShare} onChange={e => setFormData({...formData, companyShare: parseFloat(e.target.value) || 0})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Статус заказа</label>
                <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2">
                  <option value="Новый заказ">Новый заказ</option>
                  <option value="Выполнен">Выполнен</option>
                  <option value="Отменен">Отменен</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Комментарий</label>
                <input type="text" value={formData.comment} onChange={e => setFormData({...formData, comment: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
              </div>
              <div className="flex gap-2 justify-end pt-4">
                <button type="button" onClick={() => setShowOrderModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600">
                  Отмена
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
