import { test, expect } from 'bun:test';
import { cleanupScript, ownDevices, portCandidate, rewriteUrl } from './core';

test('reverse port is stable and inside the allocated range', () => {
  const port=portCandidate('aabbccddeeff',3000);
  expect(port).toBe(portCandidate('aabbccddeeff',3000));
  expect(port).toBeGreaterThanOrEqual(20000);
  expect(port).toBeLessThan(30000);
  expect(portCandidate('aabbccddeeff',3001)).not.toBe(port);
});
test('local URL changes only its origin port', () => {
  expect(rewriteUrl('http://localhost:3000/path?q=x#frag',23456)).toBe('http://localhost:23456/path?q=x#frag');
});
test('only exact workspace simulator names map to handles and UDIDs', () => {
  const devices={devices:{ios:[
    {name:'ios-sim-aabbccddeeff-2',udid:'owned',state:'Booted',deviceTypeIdentifier:'com.apple.CoreSimulator.SimDeviceType.iPhone-17'},
    {name:'ios-sim-112233445566-1',udid:'foreign',state:'Booted',deviceTypeIdentifier:'x.iPhone-17'},
    {name:'ios-sim-aabbccddeeff-not-a-number',udid:'fake',state:'Shutdown',deviceTypeIdentifier:'x.iPhone-17'}
  ]}};
  expect(ownDevices(JSON.stringify(devices),'aabbccddeeff')).toEqual([{handle:'sim2',name:'ios-sim-aabbccddeeff-2',udid:'owned',model:'iPhone 17',state:'Booted'}]);
});
test('anchor cleanup scopes deletion to this workspace', () => {
  const command=cleanupScript('aabbccddeeff');
  expect(command).toContain('^ios-sim-aabbccddeeff-[0-9]+$');
  expect(command).toContain('simctl", "shutdown"');
  expect(command).toContain('simctl", "delete"');
});
