import { describe, expect, it } from 'vitest'
import { validateQuickBooksQuery } from '@/tools/quickbooks/utils'

describe('validateQuickBooksQuery', () => {
  it('allows case-insensitive entity names', () => {
    const query = "SELECT * FROM billpayment WHERE Id = '123'"
    expect(() => validateQuickBooksQuery(query, 'BillPayment')).not.toThrow()
  })

  it('allows mixed-case entity names', () => {
    const query = "SELECT * FROM TimeActivity WHERE Id = '1'"
    expect(() => validateQuickBooksQuery(query, 'TimeActivity')).not.toThrow()
  })

  it('rejects mismatched entities', () => {
    const query = "SELECT * FROM Invoice WHERE Id = '1'"
    expect(() => validateQuickBooksQuery(query, 'Bill')).toThrow(
      "Query entity 'Invoice' does not match expected entity 'Bill'"
    )
  })
})
