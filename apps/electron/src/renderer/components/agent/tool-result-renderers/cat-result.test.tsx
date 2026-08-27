import React from 'react'
import { expect, test } from 'bun:test'
import { Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import { CatResultRenderer } from './cat-result'

test('CAT 读取结果就地显示内容', () => {
  const result = JSON.stringify({
    query: '动物派对',
    results: [{
      id: 'ter-1',
      term: '动物派对',
      translation: 'Party Animals',
      status: 'allowed',
      caseSensitive: false,
    }],
    total: 1,
    limit: 20,
    projectId: 'prj-d9bdd5f5566fabe2',
  })
  const html = renderToStaticMarkup(
    <Provider>
      <CatResultRenderer toolName="cat_search_terms" result={result} isError={false} />
    </Provider>,
  )

  expect(html).toContain('Party Animals')
  expect(html).not.toContain('<button')
})
