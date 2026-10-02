import { describe, expect, test } from 'bun:test';
import { port, remoteCommand, serveOptions } from './core';

describe('remote serve-sim adapter', () => {
  test('quotes shell arguments without interpreting their contents', () => {
    const command = remoteCommand(['type', 'hello; touch /tmp/oops', '-d', 'device'], '$HOME/lease');
    expect(command).toContain("exec serve-sim 'type' 'hello; touch /tmp/oops' '-d' 'device'");
  });

  test('accepts unprivileged ports and rejects invalid or reserved ports', () => {
    expect(port('4101')).toBe(4101);
    for (const invalid of ['0', '80', '2999', '24800', '65536', '12.3', '-1', '3000;id', '']) {
      expect(() => port(invalid)).toThrow();
    }
  });

  test('keeps upstream argument order and values intact', () => {
    expect(serveOptions(['--local-port', '4102', '--remote-port', '43202', '--model', 'iPhone 17', '--', '--fit', '--codec', 'mjpeg']))
      .toEqual({local: 4102, remote: 43202, model: 'iPhone 17', upstream: ['--fit', '--codec', 'mjpeg']});
    expect(serveOptions(['--local-port=4102', '--model=iPad mini (A17 Pro)']))
      .toEqual({local: 4102, remote: 43201, model: 'iPad mini (A17 Pro)', upstream: []});
    expect(serveOptions([])).toEqual({local: 4101, remote: 43201, model: 'iPhone 17', upstream: []});
    expect(serveOptions(['--', '--fit'])).toEqual({local: 4101, remote: 43201, model: 'iPhone 17', upstream: ['--fit']});
  });

  test('rejects malformed wrapper options or upstream modes that break the tunnel', () => {
    for (const args of [['--local-port'], ['--wat', '1'], ['iPhone 17'], ['--', '--detach'], ['--', '--port=3200'], ['--', '-p', '3200'], ['--', 'iPhone 17'], ['--', '--panes']]) {
      expect(() => serveOptions(args)).toThrow();
    }
  });
});
