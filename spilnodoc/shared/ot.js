/**
 * Операційне перетворення (Operational Transformation) для простого тексту.
 *
 * Операція — це послідовність компонентів, що проходять документ зліва направо:
 *   ціле додатне число n  — пропустити (retain) n символів без змін;
 *   рядок s              — вставити (insert) рядок s у поточну позицію;
 *   ціле від'ємне число -n — видалити (delete) n символів.
 *
 * Модуль використовується і сервером, і клієнтом, тому не має залежностей.
 */

export const isRetain = (c) => typeof c === 'number' && c > 0;
export const isInsert = (c) => typeof c === 'string';
export const isDelete = (c) => typeof c === 'number' && c < 0;

export class TextOperation {
  constructor() {
    this.ops = [];
    this.baseLength = 0;   // довжина документа, до якого застосовується операція
    this.targetLength = 0; // довжина документа після застосування
  }

  retain(n) {
    if (n === 0) return this;
    this.baseLength += n;
    this.targetLength += n;
    const last = this.ops.length - 1;
    if (isRetain(this.ops[last])) this.ops[last] += n;
    else this.ops.push(n);
    return this;
  }

  insert(str) {
    if (str === '') return this;
    this.targetLength += str.length;
    const ops = this.ops;
    const last = ops.length - 1;
    if (isInsert(ops[last])) {
      ops[last] += str;
    } else if (isDelete(ops[last])) {
      // Канонічна форма: вставка завжди стоїть перед видаленням
      if (isInsert(ops[last - 1])) ops[last - 1] += str;
      else { ops.push(ops[last]); ops[last] = str; }
    } else {
      ops.push(str);
    }
    return this;
  }

  delete(n) {
    if (typeof n === 'string') n = n.length;
    if (n === 0) return this;
    if (n > 0) n = -n;
    this.baseLength -= n;
    const last = this.ops.length - 1;
    if (isDelete(this.ops[last])) this.ops[last] += n;
    else this.ops.push(n);
    return this;
  }

  isNoop() {
    return this.ops.length === 0 || (this.ops.length === 1 && isRetain(this.ops[0]));
  }

  /** Застосовує операцію до рядка і повертає новий рядок. */
  apply(str) {
    if (str.length !== this.baseLength) {
      throw new Error('Довжина документа не збігається з базовою довжиною операції');
    }
    const parts = [];
    let pos = 0;
    for (const c of this.ops) {
      if (isRetain(c)) {
        parts.push(str.slice(pos, pos + c));
        pos += c;
      } else if (isInsert(c)) {
        parts.push(c);
      } else {
        pos -= c;
      }
    }
    return parts.join('');
  }

  toJSON() {
    return this.ops;
  }

  /** Створює операцію з масиву компонентів із перевіркою коректності. */
  static fromJSON(ops) {
    if (!Array.isArray(ops)) throw new Error('Операція має бути масивом');
    const op = new TextOperation();
    for (const c of ops) {
      if (isRetain(c) && Number.isInteger(c)) op.retain(c);
      else if (isInsert(c)) op.insert(c);
      else if (isDelete(c) && Number.isInteger(c)) op.delete(c);
      else throw new Error('Невідомий компонент операції');
    }
    return op;
  }

  /**
   * Композиція: операція, рівносильна послідовному застосуванню a, потім b.
   * Використовується клієнтом для накопичення ще не надісланих змін.
   */
  static compose(a, b) {
    if (a.targetLength !== b.baseLength) {
      throw new Error('Неможливо скомпонувати операції різної довжини');
    }
    const result = new TextOperation();
    const ops1 = a.ops.slice();
    const ops2 = b.ops.slice();
    let i1 = 0;
    let i2 = 0;
    let op1 = ops1[i1++];
    let op2 = ops2[i2++];

    while (op1 !== undefined || op2 !== undefined) {
      if (isDelete(op1)) { result.delete(op1); op1 = ops1[i1++]; continue; }
      if (isInsert(op2)) { result.insert(op2); op2 = ops2[i2++]; continue; }
      if (op1 === undefined || op2 === undefined) {
        throw new Error('Некоректна композиція: операції різної довжини');
      }

      if (isRetain(op1) && isRetain(op2)) {
        if (op1 > op2) { result.retain(op2); op1 -= op2; op2 = ops2[i2++]; }
        else if (op1 === op2) { result.retain(op1); op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { result.retain(op1); op2 -= op1; op1 = ops1[i1++]; }
      } else if (isInsert(op1) && isDelete(op2)) {
        if (op1.length > -op2) { op1 = op1.slice(-op2); op2 = ops2[i2++]; }
        else if (op1.length === -op2) { op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { op2 += op1.length; op1 = ops1[i1++]; }
      } else if (isInsert(op1) && isRetain(op2)) {
        if (op1.length > op2) { result.insert(op1.slice(0, op2)); op1 = op1.slice(op2); op2 = ops2[i2++]; }
        else if (op1.length === op2) { result.insert(op1); op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { result.insert(op1); op2 -= op1.length; op1 = ops1[i1++]; }
      } else if (isRetain(op1) && isDelete(op2)) {
        if (op1 > -op2) { result.delete(op2); op1 += op2; op2 = ops2[i2++]; }
        else if (op1 === -op2) { result.delete(op2); op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { result.delete(op1); op2 += op1; op1 = ops1[i1++]; }
      }
    }
    return result;
  }

  /**
   * Перетворення двох паралельних операцій a і b, створених над одним станом.
   * Повертає [a', b'] такі, що apply(apply(S, a), b') === apply(apply(S, b), a').
   * При одночасній вставці в одну позицію першою вважається вставка з a.
   */
  static transform(a, b) {
    if (a.baseLength !== b.baseLength) {
      throw new Error('Паралельні операції мають різну базову довжину');
    }
    const aPrime = new TextOperation();
    const bPrime = new TextOperation();
    const ops1 = a.ops.slice();
    const ops2 = b.ops.slice();
    let i1 = 0;
    let i2 = 0;
    let op1 = ops1[i1++];
    let op2 = ops2[i2++];

    while (op1 !== undefined || op2 !== undefined) {
      if (isInsert(op1)) {
        aPrime.insert(op1);
        bPrime.retain(op1.length);
        op1 = ops1[i1++];
        continue;
      }
      if (isInsert(op2)) {
        aPrime.retain(op2.length);
        bPrime.insert(op2);
        op2 = ops2[i2++];
        continue;
      }
      if (op1 === undefined || op2 === undefined) {
        throw new Error('Некоректне перетворення: операції різної довжини');
      }

      let len;
      if (isRetain(op1) && isRetain(op2)) {
        if (op1 > op2) { len = op2; op1 -= op2; op2 = ops2[i2++]; }
        else if (op1 === op2) { len = op2; op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { len = op1; op2 -= op1; op1 = ops1[i1++]; }
        aPrime.retain(len);
        bPrime.retain(len);
      } else if (isDelete(op1) && isDelete(op2)) {
        // Обидві операції видаляють той самий фрагмент — у результат не потрапляє нічого
        if (-op1 > -op2) { op1 -= op2; op2 = ops2[i2++]; }
        else if (op1 === op2) { op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { op2 -= op1; op1 = ops1[i1++]; }
      } else if (isDelete(op1) && isRetain(op2)) {
        if (-op1 > op2) { len = op2; op1 += op2; op2 = ops2[i2++]; }
        else if (-op1 === op2) { len = op2; op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { len = -op1; op2 += op1; op1 = ops1[i1++]; }
        aPrime.delete(len);
      } else if (isRetain(op1) && isDelete(op2)) {
        if (op1 > -op2) { len = -op2; op1 += op2; op2 = ops2[i2++]; }
        else if (op1 === -op2) { len = op1; op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { len = op1; op2 += op1; op1 = ops1[i1++]; }
        bPrime.delete(len);
      }
    }
    return [aPrime, bPrime];
  }
}

/**
 * Будує операцію, що перетворює рядок oldText на newText.
 * Знаходить спільний префікс і суфікс, тому для звичайного набору тексту
 * операція містить не більше трьох компонентів.
 */
export function diffToOperation(oldText, newText) {
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) start++;

  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--;
    endNew--;
  }

  return new TextOperation()
    .retain(start)
    .insert(newText.slice(start, endNew))
    .delete(endOld - start)
    .retain(oldText.length - endOld);
}

/** Зсуває позицію курсора відповідно до операції іншого користувача. */
export function transformIndex(index, operation) {
  let newIndex = index;
  let pos = 0;
  for (const c of operation.ops) {
    if (pos > index) break;
    if (isRetain(c)) {
      pos += c;
    } else if (isInsert(c)) {
      newIndex += c.length;
    } else {
      newIndex -= Math.min(index - pos, -c);
      pos -= c;
    }
  }
  return newIndex;
}
