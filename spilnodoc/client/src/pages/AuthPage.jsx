import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { navigate } from '../router.js';
import { Field } from '../components/common.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Клієнтська валідація дублює серверну лише для зручності користувача:
 * помилка показується одразу, без запиту до сервера. Остаточну перевірку
 * все одно виконує сервер.
 */
function validateForm(mode, form) {
  const errors = {};
  if (mode === 'register' && form.name.trim().length < 2) errors.name = 'Вкажіть ім\'я (щонайменше 2 символи)';
  if (!EMAIL_RE.test(form.email.trim())) errors.email = 'Некоректна адреса електронної пошти';
  if (mode === 'register') {
    if (form.password.length < 8 || !/\d/.test(form.password) || !/\p{L}/u.test(form.password)) {
      errors.password = 'Щонайменше 8 символів, літера та цифра';
    }
    if (form.password !== form.confirm) errors.confirm = 'Паролі не збігаються';
  } else if (!form.password) {
    errors.password = 'Введіть пароль';
  }
  return errors;
}

export function AuthPage({ mode }) {
  const { login, register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    const found = validateForm(mode, form);
    setErrors(found);
    setServerError('');
    if (Object.keys(found).length) return;

    setBusy(true);
    try {
      if (isRegister) await register({ name: form.name, email: form.email, password: form.password });
      else await login(form.email, form.password);
      navigate('/documents');
    } catch (err) {
      setErrors(err.details || {});
      setServerError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-intro">
        <div className="logo logo-large"><span className="logo-mark">S</span> SpilnoDoc</div>
        <h1>Пишіть разом — в одному документі й в один момент</h1>
        <ul>
          <li>Зміни співавторів з'являються миттєво, без перезавантаження</li>
          <li>Ролі доступу: власник, редактор, читач</li>
          <li>Історія версій з можливістю відновлення</li>
          <li>Розмітка Markdown з попереднім переглядом</li>
        </ul>
      </section>

      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h2>{isRegister ? 'Створення облікового запису' : 'Вхід до системи'}</h2>
        {serverError && <div className="alert">{serverError}</div>}
        {isRegister && <Field label="Ім'я" value={form.name} onChange={update('name')} error={errors.name} autoComplete="name" />}
        <Field label="Електронна пошта" type="email" value={form.email} onChange={update('email')} error={errors.email} autoComplete="email" />
        <Field
          label="Пароль" type="password" value={form.password} onChange={update('password')} error={errors.password}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
        />
        {isRegister && (
          <Field label="Повторіть пароль" type="password" value={form.confirm} onChange={update('confirm')} error={errors.confirm} autoComplete="new-password" />
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Зачекайте…' : isRegister ? 'Зареєструватися' : 'Увійти'}
        </button>
        <p className="auth-switch">
          {isRegister ? 'Вже маєте обліковий запис? ' : 'Ще не зареєстровані? '}
          <a href={isRegister ? '#/login' : '#/register'}>{isRegister ? 'Увійти' : 'Створити обліковий запис'}</a>
        </p>
      </form>
    </div>
  );
}
