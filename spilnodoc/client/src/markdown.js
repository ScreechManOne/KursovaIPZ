import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Перетворює Markdown на HTML для режиму перегляду.
 * Результат обов'язково очищується DOMPurify: текст документа вводять
 * різні користувачі, тому без очищення можлива XSS-атака через
 * вставлений тег <script> або атрибут onerror.
 */
export function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text || ''), { USE_PROFILES: { html: true } });
}

/** Номер рядка (з 1) для позиції символу — показується біля імені співавтора. */
export function lineOf(text, position) {
  let line = 1;
  for (let i = 0; i < Math.min(position, text.length); i++) if (text[i] === '\n') line++;
  return line;
}

export function countWords(text) {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}
