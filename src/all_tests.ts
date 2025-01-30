import o from "ospec";
import {BencodeError, decode, encode} from "../src/index";

function deepEquals(a: unknown, b: unknown) {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return (o(a) as any).satisfies((actual: any) => {
      const expected = b;
      if (actual.byteLength !== expected.byteLength) {
        return {
          pass: false,
          message: `${actual} should deep equals ${expected}`,
        };
      }

      for (let i = 0; i<actual.byteLength; ++i) {
        if (actual[i] !== expected[i]) {
          return {
            pass: false,
            message: `${actual} should deep equals ${expected}`,
          };
        }
      }

      return {
        pass: true,
      };
    });
  } else {
    return o(a).deepEquals(b);
  }
}

const roundTrip = (value: unknown, name?: string) => {
  const title = JSON.stringify(value ?? name);
  o(title, () => {
    const buffer = encode(value);
    const actual = decode(buffer);
    deepEquals(actual, value);
  });
};

const coerces = (input: unknown, expected: unknown) => {
  o(`${input} -> ${expected}`, () => {
    const buffer = encode(input);
    const actual = decode(buffer);
    deepEquals(actual, expected);
  });
};

const encodeFails = (input: unknown) => {
  o(`encoding ${input} should throw`, () => {
    o(() => {
      encode(input);
    }).throws(BencodeError);
  });
};

const decodeFails = (input: string) => {
  o(`decoding '${input}' should throw`, () => {
    const buf = new TextEncoder().encode(input);
    o(() => {
      decode(buf);
    }).throws(BencodeError);
  });
};

o.spec("numbers", () => {
  roundTrip(0);
  roundTrip(1);
  roundTrip(-1);
  roundTrip(-10000);
  roundTrip(10000);
  roundTrip(123456789);
  roundTrip(-123456789);

  encodeFails(NaN);
  encodeFails(Infinity);
  encodeFails(-Infinity);
  encodeFails(0.2);
  encodeFails(2**60);
});

o.spec("arrays", () => {
  roundTrip([]);
  roundTrip([0]);
  roundTrip([1]);
  roundTrip([[1]], "[[1]]");
  roundTrip([0, [1, []]]);
  roundTrip([[],[],[]]);

  coerces([-1, false, true, 2, 3], [-1, 0, 1, 2, 3]);
  coerces([true, true, 2, 3], [1, 1, 2, 3]);
});

o.spec("strings", () => {
  roundTrip(Uint8Array.from([]));
  roundTrip(Uint8Array.from([0]));
  roundTrip(Uint8Array.from([1]));
  roundTrip(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]));

  coerces("", Uint8Array.from([]));
  coerces("a", Uint8Array.from([97]));
  coerces("abc", Uint8Array.from([97, 98, 99]));
  coerces("𒀀", Uint8Array.from([240, 146, 128, 128]));
});

o.spec("booleans", () => {
  coerces(true, 1);
  coerces(false, 0);
});

o.spec("dict", () => {
  roundTrip({});
  roundTrip({a: 1});
  roundTrip({a: 1, b: 2});
  roundTrip({a: [42], b: 2});

  o(`keys should be encoded in a consistent order`, () => {
    const a = {foo: 1, bar: 2};
    const b = {bar: 2, foo: 1};
    deepEquals(encode(a), encode(b));
  });

  o(`keys should be encoded in lexicographic order`, () => {
    const a = {c: 1, a: 1, b: 1};
    deepEquals(encode(a), Uint8Array.from([
      100,49,58,97,105,49,101,49,58,98,105,49,101,49,58,99,105,49,101,101
    ]));
  });
});

o.spec("null", () => {
  encodeFails(null);
});

o.spec("undefined", () => {
  encodeFails(undefined);
});

o.spec("function", () => {
  encodeFails(() => {});
});

o.spec("bad messages", () => {
  decodeFails("");
  decodeFails("i1ei1e");
  decodeFails("i1ee");
});

o.run();

