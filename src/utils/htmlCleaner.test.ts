import { describe, it, expect } from 'vitest';
import { HtmlCleaner } from './htmlCleaner';

describe('HtmlCleaner', () => {
  it('cleans HTML text', () => {
    const input = '<a href="#">Århus &amp; København&#160;</a>';
    const expected = 'Århus & København';
    expect(HtmlCleaner.cleanHtmlText(input)).toBe(expected);
  });

  it('recursively cleans object properties', () => {
    const obj = {
      title: '<p>Hej&nbsp;verden</p>',
      nested: ['<b>bold</b>', { inner: '&oslash;' }],
    };

    const result = HtmlCleaner.cleanObject(obj);

    expect(result).toEqual({
      title: 'Hej verden',
      nested: ['bold', { inner: 'ø' }],
    });
  });
});

