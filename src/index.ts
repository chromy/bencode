const integer = "i".charCodeAt(0);
const terminator = "e".charCodeAt(0);
const minus = "-".charCodeAt(0);
const zero = "0".charCodeAt(0);
const list = "l".charCodeAt(0);
const colon = ":".charCodeAt(0);
const dict = "d".charCodeAt(0);

const terminatorSentinal = Symbol("terminatorSentinal");
const listSentinal = Symbol("listSentinal");
const dictSentinal = Symbol("dictSentinal");

let textEncoder: TextEncoder;
let textDecoder: TextDecoder;

export class BencodeError extends Error {
}

function getTextEncoder() {
  if (textEncoder) {
    return textEncoder;
  } else {
    const encoder = new TextEncoder();
    textEncoder = encoder;
    return encoder;
  }
}

function getTextDecoder() {
  if (textDecoder) {
    return textDecoder;
  } else {
    const decoder = new TextDecoder();
    textDecoder = decoder;
    return decoder;
  }
}

function countDigits(n: number): number {
  if (n === 0) {
    return 1;
  }
  let i = 0;
  for (; n >= 1; n /= 10, ++i);
  return i;
}

function safeEncodedSize(input: unknown): [number, Err] {
  let size = 0;
  const stack: unknown[] = [input];
  while (stack.length > 0) {
    const top = stack.pop();
    if (typeof top === 'number') {
      if (isNaN(top)) {
        return [0, {message: `Can not encode NaN into bencode`}];
      }
      if (!Number.isSafeInteger(top)) {
        return [0, {message: `Can not encode ${top} into bencode`}];
      }
      // i
      size += 1;
      // - if negative
      size += top < 0 ? 1 : 0;
      size += countDigits(Math.abs(top));
      // e
      size += 1;
    } else if (Array.isArray(top)) {
      size += 1; // l
      for (const e of top) {
        stack.push(e);
      }
      size += 1; // e
    } else if (top instanceof Uint8Array) {
      const sz = top.byteLength;
      size += countDigits(sz);
      size += 1; // :
      size += top.byteLength;
    } else if (typeof top === "object" && top !== null) {
      size += 1; // d
      for (const [key, value] of Object.entries(top)) {
        stack.push(key);
        stack.push(value);
      }
      size += 1; // e
    } else if (typeof top === "boolean") {
      stack.push(top ? 1 : 0);
    } else if (typeof top === "string") {
      stack.push(getTextEncoder().encode(top));
    } else {
      return [size, {message: `Can not encode ${top} into bencode`}];
    }
  }
  return [size, undefined];
}


export function safeEncode(input: unknown): [Uint8Array, Err] {
  const [size, sizeErr] = safeEncodedSize(input);
  if (sizeErr !== undefined) {
    return [new Uint8Array(), sizeErr];
  }

  const buffer = new Uint8Array(size);

  const stack = [input];
  let i = 0;

  while (stack.length > 0) {
    const top = stack.pop();
    if (typeof top === 'number') {
      buffer[i++] = integer;
      if (top < 0) {
        buffer[i++] = minus;
      }
      let n = Math.abs(top);
      let digits = countDigits(n);
      for (let j = digits; j > 0; --j) {
        buffer[i+j-1] = (n % 10) + zero;
        n /= 10;
      }
      i += digits;
      buffer[i++] = terminator;
    } else if (Array.isArray(top)) {
      buffer[i++] = list;
      stack.push(terminatorSentinal);
      for (let j = 0; j < top.length; ++j) {
        stack.push(top[top.length - j - 1]);
      }
    } else if (top instanceof Uint8Array) {
      let n = top.byteLength;
      let digits = countDigits(n);
      for (let j = digits; j > 0; --j) {
        buffer[i+j-1] = (n % 10) + zero;
        n /= 10;
      }
      i += digits;

      buffer[i++] = colon;
      for (let j = 0; j<top.byteLength; ++j) {
        buffer[i++] = top[j];
      }
    } else if (top === terminatorSentinal) {
      buffer[i++] = terminator;
    } else if (typeof top === "object" && top !== null) {
      buffer[i++] = dict;
      stack.push(terminatorSentinal);

      const keys = Object.keys(top);
      keys.sort();
      keys.reverse();

      for (const key of keys) {
        const value = (top as any)[key];
        stack.push(value);
        stack.push(key);
      }

    } else if (typeof top === "boolean") {
      stack.push(top ? 1 : 0);
    } else if (typeof top === "string") {
      stack.push(getTextEncoder().encode(top));
    } else {
      return [new Uint8Array(), {message: `Can not encode ${top} into bencode`}];
    }
  }

  return [buffer, undefined];
}

type Err = { message: string } | undefined;

export function safeDecode(buffer: Uint8Array): [unknown, Err] {
  let i = 0;
  const end = buffer.byteLength;

  const stack: any = [];

  while (i < end) {
    const c = buffer[i++];
    switch (c) {
      case integer: {
        let n = 0;
        let sign = 1;
        if (i < end && buffer[i] === minus) {
          sign = -1;
          i++;
        }

        for (; i < end && buffer[i] !== terminator; i++) {
          n *= 10;
          n += buffer[i] - zero;
        }

        n = n * sign;

        if (i < end) {
          i++; // Skip e
        }

        stack.push(n);
        break;
      }
      case list: {
        stack.push(listSentinal);
        break;
      }
      case dict: {
        stack.push(dictSentinal);
        break;
      }
      case terminator: {
        // XXX: should be >0 items in stack
        const elements = [];
        let done = false;
        while (stack.length && !done) {
          const top = stack.pop();
          if (top === listSentinal) {
            stack.push(elements);
            done = true;
          } else if (top === dictSentinal) {
            const o: any = {};
            while (elements.length >= 2) {
              const value = elements.pop();
              const rawKey = elements.pop();
              // xxx key must be Uint8Array
              const key = getTextDecoder().decode(rawKey);
              o[key] = value;
            }
            stack.push(o);
            done = true;
          } else {
            elements.unshift(top);
          }
        }
        break;
      }
      // byte string case
      default: {
        let n = 0;
        i--;
        for (; i < end && buffer[i] !== colon; i++) {
          n *= 10;
          n += buffer[i] - zero;
        }

        if (i < end) {
          // Skip colon
          i++;
        }

        if (i + n <= end) {
          stack.push(buffer.subarray(i, i+n));
          i += n;
        }
      }
    }
  }

  if (stack.length !== 1) {
    return [{}, { message: `Can't decode bencode, must have exactly one root value` }];
  }

  return [stack[0], undefined];
}

export function encode(input: unknown): Uint8Array {
  const [output, err] = safeEncode(input);
  if (err === undefined) {
    return output;
  } else {
    throw new BencodeError(err.message);
  }
}

export function decode(input: Uint8Array): unknown {
  const [output, err] = safeDecode(input);
  if (err === undefined) {
    return output;
  } else {
    throw new BencodeError(err.message);
  }
}
