// Модульні тести алгоритму операційного перетворення.
// Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { TextOperation, diffToOperation, transformIndex } from '../shared/ot.js';

function randomString(len) {
  const alphabet = 'абвгдеєжзий kl\n';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function randomOperation(str) {
  const op = new TextOperation();
  let left = str.length;
  while (left > 0) {
    const n = 1 + Math.floor(Math.random() * Math.min(left, 6));
    const r = Math.random();
    if (r < 0.2) op.insert(randomString(1 + Math.floor(Math.random() * 4)));
    else if (r < 0.5) { op.delete(n); left -= n; }
    else { op.retain(n); left -= n; }
  }
  if (Math.random() < 0.3) op.insert(randomString(2));
  return op;
}

test('apply виконує вставку, видалення і пропуск', () => {
  const op = new TextOperation().retain(6).delete(5).insert('світе');
  assert.equal(op.apply('Привіт, мир!'.slice(0, 11)), 'Привітсвіте');
});

test('diffToOperation відновлює новий текст', () => {
  const a = 'Спільне редагування документів';
  const b = 'Спільне онлайн-редагування текстових документів';
  assert.equal(diffToOperation(a, b).apply(a), b);
});

test('transform забезпечує збіжність (1000 випадкових пар)', () => {
  for (let i = 0; i < 1000; i++) {
    const s = randomString(20);
    const a = randomOperation(s);
    const b = randomOperation(s);
    const [aPrime, bPrime] = TextOperation.transform(a, b);
    assert.equal(bPrime.apply(a.apply(s)), aPrime.apply(b.apply(s)));
  }
});

test('compose рівносильна послідовному застосуванню', () => {
  for (let i = 0; i < 1000; i++) {
    const s = randomString(20);
    const a = randomOperation(s);
    const b = randomOperation(a.apply(s));
    assert.equal(TextOperation.compose(a, b).apply(s), b.apply(a.apply(s)));
  }
});

test('fromJSON відхиляє некоректні компоненти', () => {
  assert.throws(() => TextOperation.fromJSON([1.5]));
  assert.throws(() => TextOperation.fromJSON([{ x: 1 }]));
  assert.throws(() => TextOperation.fromJSON('abc'));
});

test('transformIndex зсуває курсор після вставки перед ним', () => {
  const op = new TextOperation().retain(2).insert('XYZ').retain(8);
  assert.equal(transformIndex(5, op), 8);
  assert.equal(transformIndex(1, op), 1);
});
