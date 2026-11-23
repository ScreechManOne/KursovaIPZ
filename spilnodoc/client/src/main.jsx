import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './auth.jsx';
import { useRoute, matchPath, navigate } from './router.js';
import { AuthPage } from './pages/AuthPage.jsx';
import { DocumentsPage } from './pages/DocumentsPage.jsx';
import { EditorPage } from './pages/EditorPage.jsx';
import './styles.css';

/**
 * Кореневий компонент: вибирає сторінку за маршрутом і захищає
 * приватні сторінки — неавторизованого користувача переспрямовано на вхід.
 */
function App() {
  const { user, loading } = useAuth();
  const path = useRoute();

  if (loading) return <div className="splash">Завантаження…</div>;

  const isPublic = path === '/login' || path === '/register';
  if (!user && !isPublic) {
    navigate('/login');
    return null;
  }
  if (user && (isPublic || path === '/')) {
    navigate('/documents');
    return null;
  }

  if (path === '/login') return <AuthPage mode="login" />;
  if (path === '/register') return <AuthPage mode="register" />;
  if (path === '/documents') return <DocumentsPage />;

  const editor = matchPath('/documents/:id', path);
  if (editor) return <EditorPage key={editor.id} docId={Number(editor.id)} />;

  return (
    <main className="page"><div className="empty"><p>Сторінку не знайдено.</p><a className="btn" href="#/documents">На головну</a></div></main>
  );
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
);
