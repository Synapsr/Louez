import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sanitizeProductDescriptionHtml } from './util.product-description';

test('preserves rich text formatting produced by the product editor', () => {
  const description =
    '<p>Vélo <strong>équipé</strong></p><ul><li><p>Casque</p></li></ul>';

  assert.equal(sanitizeProductDescriptionHtml(description), description);
});

test('preserves plain text line breaks', () => {
  assert.equal(
    sanitizeProductDescriptionHtml('Première ligne\nDeuxième ligne'),
    'Première ligne<br>Deuxième ligne',
  );
});

test('keeps safe links and removes unsupported attributes', () => {
  assert.equal(
    sanitizeProductDescriptionHtml(
      '<a href="https://example.com?a=1&amp;b=2" target="_blank" onclick="alert(1)">Lien</a>',
    ),
    '<a href="https://example.com?a=1&amp;b=2" rel="noopener noreferrer">Lien</a>',
  );
});

test('neutralizes executable markup and unsafe links', () => {
  assert.equal(
    sanitizeProductDescriptionHtml(
      '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="java&#115;cript:alert(3)">Lien</a>',
    ),
    '&lt;img src=x onerror="alert(1)"&gt;&lt;script&gt;alert(2)&lt;/script&gt;<a>Lien</a>',
  );
});
