import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as objc from '../scripts/lib/extractors/objc.mjs';

test('objc extractor: interface+implementation class/protocol kind+name+line+supertypes', async () => {
  await init();
  const src = [
    '#import <Foundation/Foundation.h>',
    '#import "Greeter.h"',
    '',
    '@protocol Greeter',
    '- (void)greet;',
    '@end',
    '',
    '@interface Service : NSObject <Greeter>',
    '- (void)run;',
    '@end',
    '',
    '@implementation Service',
    '- (void)run {',
    '    [self helper];',
    '}',
    '- (void)helper {',
    '}',
    '@end',
    '',
  ].join('\n');
  const res = await objc.parse('src/Service.m', src, '/proj');
  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['class:Service', 'protocol:Greeter']);

  const svc = res.declarations.find((d) => d.name === 'Service');
  assert.equal(svc.kind, 'class');
  assert.equal(svc.line, 8);
  assert.equal(svc.namespace, 'Service'); // "src" prefix dropped
  // superclass + adopted protocol
  assert.ok(svc.supertypes.includes('NSObject'), `supertypes were ${JSON.stringify(svc.supertypes)}`);
  assert.ok(svc.supertypes.includes('Greeter'), `supertypes were ${JSON.stringify(svc.supertypes)}`);
  // borrowed call-graph edge from the matching @implementation
  assert.ok(svc.refs.includes('helper'), `refs were ${JSON.stringify(svc.refs)}`);

  // imports parsed (angle-bracket and quoted), brackets/quotes stripped
  const raws = res.imports.map((i) => i.raw).sort();
  assert.deepEqual(raws, ['Foundation/Foundation.h', 'Greeter.h']);
});

test('objc extractor: bare implementation with no @interface', async () => {
  await init();
  const src = [
    '@implementation Widget',
    '- (void)tick {',
    '    [self draw];',
    '}',
    '@end',
    '',
  ].join('\n');
  const res = await objc.parse('Widget.m', src, '/proj');
  const widgets = res.declarations.filter((d) => d.name === 'Widget');
  assert.equal(widgets.length, 1, `expected one Widget decl, got ${widgets.length}`);
  assert.equal(widgets[0].kind, 'class');
  assert.equal(widgets[0].line, 1);
  assert.ok(widgets[0].refs.includes('draw'), `refs were ${JSON.stringify(widgets[0].refs)}`);
});
