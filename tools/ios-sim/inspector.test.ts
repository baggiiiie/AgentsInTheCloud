import { expect, test } from 'bun:test';
import { assertTouchTarget, inspectorSocketCommand } from './inspector';

test('touch expression rejects elements with nested interactive controls',()=>{
  const expression=assertTouchTarget('.tab');
  expect(expression).toContain('interactive descendants');
  expect(expression).toContain('element.querySelector');
  expect(expression).toContain('getBoundingClientRect');
  expect(expression).toContain('outside the visible viewport');
});
test('inspector socket discovery scopes to a UDID',()=>{
  const udid='12345678-1234-1234-1234-123456789ABC';
  expect(inspectorSocketCommand(udid)).toContain(udid);
  expect(inspectorSocketCommand(udid)).toContain('launchd_sim');
  expect(()=>inspectorSocketCommand('booted')).toThrow();
});
