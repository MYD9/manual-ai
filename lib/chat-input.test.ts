import { test } from 'vitest';
import assert from 'node:assert/strict';
import { shouldSendOnEnter } from './chat-input';

test('Enter sends; Shift+Enter and Chinese composition keep editing', () => {
  const enter = { key: 'Enter', shiftKey: false, isComposing: false };
  assert.equal(shouldSendOnEnter(enter), true);
  assert.equal(shouldSendOnEnter({ ...enter, shiftKey: true }), false);
  assert.equal(shouldSendOnEnter({ ...enter, isComposing: true }), false);
  assert.equal(shouldSendOnEnter({ ...enter, keyCode: 229 }), false);
  assert.equal(shouldSendOnEnter({ ...enter, key: 'a' }), false);
});
