import { HttpError } from './http.js';

/**
 * Декларативна перевірка вхідних даних.
 * Схема — це об'єкт, де для кожного поля задано набір правил.
 * Повертає очищений об'єкт лише з описаними полями або кидає HttpError 400
 * зі списком помилок по кожному полю.
 */
export function validate(input, schema) {
  const errors = {};
  const output = {};
  const data = input && typeof input === 'object' ? input : {};

  for (const [field, rules] of Object.entries(schema)) {
    let value = data[field];

    if (value === undefined || value === null || value === '') {
      if (rules.required) errors[field] = rules.message || 'Поле є обов\'язковим';
      else if (rules.default !== undefined) output[field] = rules.default;
      continue;
    }

    if (rules.type === 'string') {
      if (typeof value !== 'string') { errors[field] = 'Очікується рядок'; continue; }
      if (rules.trim !== false) value = value.trim();
      if (rules.min !== undefined && value.length < rules.min) {
        errors[field] = `Мінімальна довжина — ${rules.min} символів`; continue;
      }
      if (rules.max !== undefined && value.length > rules.max) {
        errors[field] = `Максимальна довжина — ${rules.max} символів`; continue;
      }
      if (rules.pattern && !rules.pattern.test(value)) {
        errors[field] = rules.message || 'Некоректний формат'; continue;
      }
      if (rules.oneOf && !rules.oneOf.includes(value)) {
        errors[field] = `Допустимі значення: ${rules.oneOf.join(', ')}`; continue;
      }
    }

    if (rules.type === 'integer') {
      if (!Number.isInteger(value)) { errors[field] = 'Очікується ціле число'; continue; }
      if (rules.min !== undefined && value < rules.min) { errors[field] = `Значення не менше ${rules.min}`; continue; }
    }

    if (rules.type === 'array' && !Array.isArray(value)) { errors[field] = 'Очікується масив'; continue; }

    output[field] = value;
  }

  if (Object.keys(errors).length > 0) throw new HttpError(400, 'Помилка валідації даних', errors);
  return output;
}

/** Перетворює параметр шляху на додатне ціле число або повертає 404. */
export function idParam(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, 'Ресурс не знайдено');
  return id;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Пароль: від 8 символів, хоча б одна літера і одна цифра. */
export const PASSWORD_RE = /^(?=.*\p{L})(?=.*\d).{8,}$/u;
