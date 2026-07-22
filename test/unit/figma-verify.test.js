import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figmaImageUrl, findNodeByName, firstTopLevelFrame } from '../figma-verify.js';

// A minimal Figma document JSON (shape as returned by GET /v1/files/:key).
const doc = {
  document: {
    id: '0:0', name: 'Document', type: 'DOCUMENT',
    children: [
      {
        id: '0:1', name: 'Page 1', type: 'CANVAS',
        children: [
          {
            id: '10:2', name: 'Page', type: 'FRAME',
            children: [
              { id: '10:3', name: 'Hero', type: 'FRAME', children: [] },
              {
                id: '10:4', name: 'Card / Pro', type: 'COMPONENT',
                children: [{ id: '10:5', name: 'Badge', type: 'FRAME', children: [] }],
              },
            ],
          },
        ],
      },
    ],
  },
};

test('figmaImageUrl: builds the REST export URL with ids/format/scale', () => {
  const url = figmaImageUrl('ABC123', '10:4');
  assert.ok(url.startsWith('https://api.figma.com/v1/images/ABC123?'));
  assert.match(url, /ids=10%3A4/);
  assert.match(url, /format=png/);
  assert.match(url, /scale=2/);
});

test('figmaImageUrl: honors custom scale/format', () => {
  const url = figmaImageUrl('K', 'n', { format: 'svg', scale: 1 });
  assert.match(url, /format=svg/);
  assert.match(url, /scale=1/);
});

test('findNodeByName: finds a nested node by exact name', () => {
  assert.equal(findNodeByName(doc.document, 'Card / Pro').id, '10:4');
  assert.equal(findNodeByName(doc.document, 'Badge').id, '10:5');
  assert.equal(findNodeByName(doc.document, 'Hero').id, '10:3');
});

test('findNodeByName: missing name → null', () => {
  assert.equal(findNodeByName(doc.document, 'Nope'), null);
  assert.equal(findNodeByName(null, 'x'), null);
});

test('firstTopLevelFrame: first canvas child that is a frame/component/instance', () => {
  assert.equal(firstTopLevelFrame(doc.document).id, '10:2');
  assert.equal(firstTopLevelFrame({ children: [] }), null);
});
