import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { isExcluded, matchesSelector } from '../core/utils';

function makeClient(meta: Record<string, unknown>): WebSocket {
  const ws = { meta } as unknown as WebSocket;
  return ws;
}

describe('matchesSelector', () => {
  describe('equality shorthand', () => {
    it('matches when field equals value', () => {
      const client = makeClient({ role: 'admin' });
      expect(matchesSelector({ role: 'admin' }, client)).toBe(true);
    });

    it('does not match when field differs', () => {
      const client = makeClient({ role: 'user' });
      expect(matchesSelector({ role: 'admin' }, client)).toBe(false);
    });

    it('matches undefined field against undefined selector', () => {
      const client = makeClient({});
      expect(matchesSelector({ role: undefined }, client)).toBe(true);
    });
  });

  describe('$eq', () => {
    it('matches equal value', () => {
      const client = makeClient({ age: 30 });
      expect(matchesSelector({ age: { $eq: 30 } }, client)).toBe(true);
    });

    it('does not match different value', () => {
      const client = makeClient({ age: 25 });
      expect(matchesSelector({ age: { $eq: 30 } }, client)).toBe(false);
    });
  });

  describe('$ne', () => {
    it('matches when value is not equal', () => {
      const client = makeClient({ role: 'user' });
      expect(matchesSelector({ role: { $ne: 'admin' } }, client)).toBe(true);
    });

    it('does not match when value is equal', () => {
      const client = makeClient({ role: 'admin' });
      expect(matchesSelector({ role: { $ne: 'admin' } }, client)).toBe(false);
    });
  });

  describe('$in', () => {
    it('matches when value is in the array', () => {
      const client = makeClient({ role: 'editor' });
      expect(matchesSelector({ role: { $in: ['admin', 'editor'] } }, client)).toBe(true);
    });

    it('does not match when value is not in the array', () => {
      const client = makeClient({ role: 'guest' });
      expect(matchesSelector({ role: { $in: ['admin', 'editor'] } }, client)).toBe(false);
    });
  });

  describe('$nin', () => {
    it('matches when value is not in the array', () => {
      const client = makeClient({ role: 'guest' });
      expect(matchesSelector({ role: { $nin: ['admin', 'editor'] } }, client)).toBe(true);
    });

    it('does not match when value is in the array', () => {
      const client = makeClient({ role: 'admin' });
      expect(matchesSelector({ role: { $nin: ['admin', 'editor'] } }, client)).toBe(false);
    });
  });

  describe('$gt', () => {
    it('matches when value is greater than threshold', () => {
      const client = makeClient({ score: 100 });
      expect(matchesSelector({ score: { $gt: 50 } }, client)).toBe(true);
    });

    it('does not match when value equals threshold', () => {
      const client = makeClient({ score: 50 });
      expect(matchesSelector({ score: { $gt: 50 } }, client)).toBe(false);
    });

    it('does not match when value is less than threshold', () => {
      const client = makeClient({ score: 10 });
      expect(matchesSelector({ score: { $gt: 50 } }, client)).toBe(false);
    });

    it('does not match when value is not a number', () => {
      const client = makeClient({ score: '100' });
      expect(matchesSelector({ score: { $gt: 50 } }, client)).toBe(false);
    });
  });

  describe('$gte', () => {
    it('matches when value equals threshold', () => {
      const client = makeClient({ score: 50 });
      expect(matchesSelector({ score: { $gte: 50 } }, client)).toBe(true);
    });

    it('matches when value is greater than threshold', () => {
      const client = makeClient({ score: 51 });
      expect(matchesSelector({ score: { $gte: 50 } }, client)).toBe(true);
    });

    it('does not match when value is less than threshold', () => {
      const client = makeClient({ score: 49 });
      expect(matchesSelector({ score: { $gte: 50 } }, client)).toBe(false);
    });
  });

  describe('$lt', () => {
    it('matches when value is less than threshold', () => {
      const client = makeClient({ score: 10 });
      expect(matchesSelector({ score: { $lt: 50 } }, client)).toBe(true);
    });

    it('does not match when value equals threshold', () => {
      const client = makeClient({ score: 50 });
      expect(matchesSelector({ score: { $lt: 50 } }, client)).toBe(false);
    });

    it('does not match when value is greater', () => {
      const client = makeClient({ score: 100 });
      expect(matchesSelector({ score: { $lt: 50 } }, client)).toBe(false);
    });
  });

  describe('$lte', () => {
    it('matches when value equals threshold', () => {
      const client = makeClient({ score: 50 });
      expect(matchesSelector({ score: { $lte: 50 } }, client)).toBe(true);
    });

    it('matches when value is less than threshold', () => {
      const client = makeClient({ score: 49 });
      expect(matchesSelector({ score: { $lte: 50 } }, client)).toBe(true);
    });

    it('does not match when value is greater', () => {
      const client = makeClient({ score: 51 });
      expect(matchesSelector({ score: { $lte: 50 } }, client)).toBe(false);
    });
  });

  describe('$exists', () => {
    it('matches when field exists and $exists is true', () => {
      const client = makeClient({ name: 'Alice' });
      expect(matchesSelector({ name: { $exists: true } }, client)).toBe(true);
    });

    it('does not match when field is missing and $exists is true', () => {
      const client = makeClient({});
      expect(matchesSelector({ name: { $exists: true } }, client)).toBe(false);
    });

    it('matches when field is missing and $exists is false', () => {
      const client = makeClient({});
      expect(matchesSelector({ name: { $exists: false } }, client)).toBe(true);
    });

    it('does not match when field exists and $exists is false', () => {
      const client = makeClient({ name: 'Alice' });
      expect(matchesSelector({ name: { $exists: false } }, client)).toBe(false);
    });
  });

  describe('multiple keys (AND logic)', () => {
    it('matches when all conditions are satisfied', () => {
      const client = makeClient({ role: 'admin', score: 90 });
      expect(matchesSelector({ role: 'admin', score: { $gte: 80 } }, client)).toBe(true);
    });

    it('does not match when any condition fails', () => {
      const client = makeClient({ role: 'admin', score: 70 });
      expect(matchesSelector({ role: 'admin', score: { $gte: 80 } }, client)).toBe(false);
    });

    it('handles empty selector (matches everything)', () => {
      const client = makeClient({ role: 'user' });
      expect(matchesSelector({}, client)).toBe(true);
    });
  });
});

describe('isExcluded', () => {
  it('returns false when opts is undefined', () => {
    const client = makeClient({ role: 'admin' });
    expect(isExcluded(undefined, client)).toBe(false);
  });

  it('returns false when opts has no except', () => {
    const client = makeClient({ role: 'admin' });
    expect(isExcluded({}, client)).toBe(false);
  });

  it('returns true when client matches the except selector', () => {
    const client = makeClient({ role: 'admin' });
    expect(isExcluded({ except: { role: 'admin' } }, client)).toBe(true);
  });

  it('returns false when client does not match the except selector', () => {
    const client = makeClient({ role: 'user' });
    expect(isExcluded({ except: { role: 'admin' } }, client)).toBe(false);
  });
});
