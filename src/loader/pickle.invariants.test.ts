import { describe, expect, it, vi } from 'vitest';
import { ParseError } from './errors';
import { parseModelFile } from './parse';
import { unpickle } from './pickle';
import { Handler, Placeholder, type PyValue } from './pyvalue';
import { findClass, makePersistentLoad } from './torch';
import { PickleWriter, buildModelPt } from './testFixture';

function setup() {
  const spy = vi.fn(() => null);
  const hooks = {
    findClass: (module: string, name: string): PyValue =>
      module === 'test' && name === 'spy' ? new Handler('test.spy', spy) : findClass(module, name),
    persistentLoad: makePersistentLoad(new Map()),
  };
  return { spy, hooks };
}

/** Pushes the hostile dict of case (a). */
function hostileDict(w: PickleWriter): PickleWriter {
  w.emptyDict().mark();
  w.str('__proto__').global('test', 'spy');
  w.str('constructor').int(1);
  w.str('prototype').int(2);
  w.str('call').global('test', 'spy');
  w.str('__build__').global('test', 'spy');
  w.str('new').int(3);
  return w.setitems();
}

const protoNames = () => Object.getOwnPropertyNames(Object.prototype).sort();

describe('pickle VM invariants', () => {
  it('(a) hostile dict keys stay inside a Map', () => {
    const { spy, hooks } = setup();
    const before = protoNames();
    const result = unpickle(hostileDict(new PickleWriter().proto()).stop().bytes(), hooks);
    expect(result).toBeInstanceOf(Map);
    expect(Object.getPrototypeOf(result)).toBe(Map.prototype);
    const m = result as Map<PyValue, PyValue>;
    expect(m.get('__proto__')).toBeInstanceOf(Handler);
    expect(m.size).toBe(6);
    expect(protoNames()).toEqual(before);
    expect(({} as Record<string, unknown>).call).toBeUndefined();
    expect(({} as Record<string, unknown>).__build__).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['REDUCE', 0x52],
    ['NEWOBJ', 0x81],
  ])('(b) the hostile dict used as a callable via %s is an inert placeholder', (_n, op) => {
    const { spy, hooks } = setup();
    const w = hostileDict(new PickleWriter().proto()).emptyTuple().raw(op).stop();
    const result = unpickle(w.bytes(), hooks);
    expect(result).toBeInstanceOf(Placeholder);
    expect((result as Placeholder).module).toBe('<invalid>');
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('(c) BUILD stores state on the placeholder only', () => {
    const { spy, hooks } = setup();
    const w = new PickleWriter().proto().global('tbp.monty', 'X').emptyTuple().newobj();
    hostileDict(w).build().stop();
    const result = unpickle(w.bytes(), hooks);
    expect(result).toBeInstanceOf(Placeholder);
    const p = result as Placeholder;
    expect(p.module).toBe('tbp.monty');
    expect(p.state).toBeInstanceOf(Map);
    for (const k of ['__build__', 'call', 'constructor', 'new'])
      expect(Object.hasOwn(p, k)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(0);

    const twice = new PickleWriter().proto().global('tbp.monty', 'X').emptyTuple().newobj();
    twice.emptyDict().build().emptyDict().build().stop();
    expect(() => unpickle(twice.bytes(), hooks)).toThrow(ParseError);
  });

  it('(d) SETITEM / APPEND / BUILD on the wrong target throw ParseError', () => {
    const { hooks } = setup();
    const p = () => new PickleWriter().proto();
    const bad = [
      hostileDict(p().emptyDict()).build().stop(), // BUILD with non-null state on a Map
      p().emptyList().str('k').int(1).setitem().stop(), // SETITEM on a list
      p().emptyDict().int(1).append().stop(), // APPEND on a dict
      p().global('tbp.monty', 'X').emptyTuple().newobj().str('k').int(1).setitem().stop(), // SETITEM on a Placeholder
      p().emptyList().mark().str('k').setitems().stop(), // odd SETITEMS (and non-dict)
      p().emptyDict().mark().str('k').setitems().stop(), // odd SETITEMS
      p().binget(7).stop(), // unset memo key
    ];
    for (const w of bad) expect(() => unpickle(w.bytes(), hooks)).toThrow(ParseError);
  });

  it('(e) handlers fed mistyped args throw ParseError, not TypeError', () => {
    const { hooks } = setup();
    const tensor = new PickleWriter().proto().global('torch._utils', '_rebuild_tensor_v2');
    tensor.mark().str('x').tuple().reduce().stop();
    expect(() => unpickle(tensor.bytes(), hooks)).toThrow(ParseError);
    expect(() => unpickle(tensor.bytes(), hooks)).toThrow(
      /Bad arguments for torch\._utils\._rebuild_tensor_v2 at byte \d+/,
    );

    const scalar = new PickleWriter().proto().global('numpy.core.multiarray', 'scalar');
    scalar.mark().int(1).int(2).tuple().reduce().stop();
    expect(() => unpickle(scalar.bytes(), hooks)).toThrow(ParseError);

    const dtype = new PickleWriter()
      .proto()
      .global('numpy', 'dtype')
      .mark()
      .int(5)
      .tuple()
      .reduce()
      .stop();
    expect(() => unpickle(dtype.bytes(), hooks)).toThrow(ParseError);

    const codec = new PickleWriter()
      .proto()
      .global('_codecs', 'encode')
      .mark()
      .str('a')
      .str('rot13')
      .tuple()
      .reduce()
      .stop();
    expect(() => unpickle(codec.bytes(), hooks)).toThrow(/Unsupported codec/);

    const pid = new PickleWriter()
      .proto()
      .mark()
      .str('storage')
      .str('notaclass')
      .str('0')
      .str('cpu')
      .int(1)
      .tuple()
      .binpersid()
      .stop();
    expect(() => unpickle(pid.bytes(), hooks)).toThrow(ParseError);
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    '(f) graph id %s loads like any other',
    async (graphId) => {
      const before = protoNames();
      const m = await parseModelFile(
        new Blob([buildModelPt({ graphId }) as Uint8Array<ArrayBuffer>]),
        'x.pt',
      );
      expect(m.lms[0].graphIds).toEqual([graphId]);
      const g = m.lms[0].graphs.get(graphId)!;
      expect(g.channels[0].channel).toBe('patch');
      expect(g.channels[0].n).toBe(4);
      expect(protoNames()).toEqual(before);
      expect(({} as Record<string, unknown>).patch).toBeUndefined();
    },
  );

  it('a feature named __proto__ is an ordinary own key', async () => {
    const m = await parseModelFile(
      new Blob([
        buildModelPt({
          featureMapping: {
            pose_vectors: [0, 9],
            __proto__x: [9, 10],
            ['__proto__']: [10, 11],
          } as never,
        }) as Uint8Array<ArrayBuffer>,
      ]),
      'x.pt',
    );
    const c = m.lms[0].graphs.get('g')!.channels[0];
    expect(Object.getPrototypeOf(c.features)).toBe(null);
    expect(Object.keys(c.features)).toContain('pose_vectors');
    expect(Object.hasOwn(c.features, '__proto__')).toBe(true);
    expect(c.features['__proto__']).toEqual([10, 11]);
  });
});
