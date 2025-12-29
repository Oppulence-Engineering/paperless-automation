import { describe, expect, it } from 'vitest'
import type { PlaidTransaction } from '@/tools/plaid/types'
import { plaidCategorizeTransactionsTool } from '@/tools/plaid/categorize_transactions'
import { plaidDetectRecurringTool } from '@/tools/plaid/detect_recurring'

const baseTransaction: PlaidTransaction = {
  transaction_id: 'tx_base',
  account_id: 'acc_1',
  amount: 12.34,
  iso_currency_code: 'USD',
  unofficial_currency_code: null,
  category: ['Other', 'Other'],
  category_id: null,
  date: '2024-01-01',
  authorized_date: null,
  name: 'Base',
  merchant_name: 'Base',
  payment_channel: 'online',
  pending: false,
  pending_transaction_id: null,
  account_owner: null,
  location: {
    address: null,
    city: null,
    region: null,
    postal_code: null,
    country: null,
    lat: null,
    lon: null,
    store_number: null,
  },
  payment_meta: {
    reference_number: null,
    ppd_id: null,
    payee: null,
    by_order_of: null,
    payer: null,
    payment_method: null,
    payment_processor: null,
    reason: null,
  },
  transaction_type: 'digital',
}

const makeTransaction = (overrides: Partial<PlaidTransaction>): PlaidTransaction => ({
  ...baseTransaction,
  ...overrides,
  location: {
    ...baseTransaction.location,
    ...(overrides.location ?? {}),
  },
  payment_meta: {
    ...baseTransaction.payment_meta,
    ...(overrides.payment_meta ?? {}),
  },
})

describe('Plaid local tools', () => {
  it('categorizes transactions using historical matches', async () => {
    const result = await plaidCategorizeTransactionsTool.directExecution?.({
      transactions: [
        makeTransaction({
          transaction_id: 'tx_1',
          merchant_name: 'Acme Inc',
          name: 'Acme Inc',
        }),
      ],
      historicalCategories: [
        {
          merchant: 'acme inc',
          category: 'Office Supplies',
          subcategory: 'Hardware',
        },
      ],
    })

    expect(result?.success).toBe(true)
    expect(result?.output.categorized_transactions[0].suggested_category).toBe('Office Supplies')
    expect(result?.output.categorized_transactions[0].suggested_subcategory).toBe('Hardware')
  })

  it('uses existing categories when AI is disabled', async () => {
    const result = await plaidCategorizeTransactionsTool.directExecution?.({
      transactions: [
        makeTransaction({
          transaction_id: 'tx_2',
          merchant_name: 'Hotel',
          name: 'Hotel',
          category: ['Travel', 'Lodging'],
        }),
      ],
      useAI: false,
    })

    expect(result?.success).toBe(true)
    expect(result?.output.categorized_transactions[0].suggested_category).toBe('Travel')
    expect(result?.output.categorized_transactions[0].suggested_subcategory).toBe('Lodging')
  })

  it('returns zero confidence for empty categorization input', async () => {
    const result = await plaidCategorizeTransactionsTool.directExecution?.({
      transactions: [],
    })

    expect(result?.success).toBe(true)
    expect(result?.output.metadata.avg_confidence).toBe(0)
  })

  it('rejects categorization when transactions is not an array', async () => {
    const result = await plaidCategorizeTransactionsTool.directExecution?.({
      transactions: 'invalid' as any,
    })

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('transactions must be an array')
  })

  it('detects monthly recurring transactions', async () => {
    const transactions = [
      makeTransaction({
        transaction_id: 'tx_3',
        merchant_name: 'Netflix',
        name: 'Netflix',
        amount: -15,
        date: '2024-01-01',
      }),
      makeTransaction({
        transaction_id: 'tx_4',
        merchant_name: 'Netflix',
        name: 'Netflix',
        amount: -15.1,
        date: '2024-02-01',
      }),
      makeTransaction({
        transaction_id: 'tx_5',
        merchant_name: 'Netflix',
        name: 'Netflix',
        amount: -15.05,
        date: '2024-03-02',
      }),
    ]

    const result = await plaidDetectRecurringTool.directExecution?.({
      transactions,
      minOccurrences: 3,
      toleranceDays: 3,
      amountTolerance: 0.1,
    })

    expect(result?.success).toBe(true)
    expect(result?.output.recurring_subscriptions).toHaveLength(1)
    expect(result?.output.recurring_subscriptions[0].frequency).toBe('monthly')
  })

  it('rejects recurring detection when transactions is not an array', async () => {
    const result = await plaidDetectRecurringTool.directExecution?.({
      transactions: 'invalid' as any,
    })

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('transactions must be an array')
  })
})
