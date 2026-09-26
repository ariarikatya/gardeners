import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-6 text-center space-y-4">
        <div className="text-4xl">🔍</div>
        <h1 className="text-xl font-bold text-slate-800">Страница не найдена</h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          Запрошенная страница не существует или была перемещена.
        </p>
        <div className="pt-2">
          <Link
            href="/login"
            className="inline-block w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            Войти в систему
          </Link>
        </div>
      </div>
    </div>
  );
}
