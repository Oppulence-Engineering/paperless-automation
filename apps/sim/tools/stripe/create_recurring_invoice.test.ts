import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSubscriptionMock = vi.fn()

vi.mock('stripe', () => ({
  default: class Stripe {
    subscriptions = {
      create: createSubscriptionMock,
    }
  },
}))

import { stripeCreateRecurringInvoiceTool } from '@/tools/stripe/create_recurring_invoice'

describe('stripeCreateRecurringInvoiceTool', () => {
  beforeEach(() => {
    createSubscriptionMock.mockReset()
  })

  it('creates a subscription and maps invoice output', async () => {
    const subscription = {
      customer: 'cus_123',
      current_period_end: 1710000000,
      latest_invoice: {
        id: 'in_123',
        amount_due: 1234,
        status: 'open',
        created: 1700000000,
        due_date: 1700003600,
        invoice_pdf: 'https://example.com/invoice.pdf',
        hosted_invoice_url: 'https://example.com/invoice',
      },
    }

    createSubscriptionMock.mockResolvedValue(subscription)

    const result = await stripeCreateRecurringInvoiceTool.directExecution?.({
      apiKey: 'sk_test_123',
      customer: 'cus_123',
      amount: 12.34,
      currency: 'usd',
      interval: 'month',
      intervalCount: 2,
      description: 'Pro plan',
      autoAdvance: false,
      daysUntilDue: 14,
    })

    expect(createSubscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_123',
        collection_method: 'send_invoice',
        days_until_due: 14,
        items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              currency: 'usd',
              unit_amount: 1234,
              recurring: expect.objectContaining({
                interval: 'month',
                interval_count: 2,
              }),
            }),
          }),
        ],
        metadata: expect.objectContaining({
          interval: 'month',
          interval_count: '2',
        }),
      })
    )

    expect(result?.success).toBe(true)
    expect(result?.output.invoice.id).toBe('in_123')
    expect(result?.output.recurring_schedule.next_invoice_date).toBe(
      new Date(subscription.current_period_end * 1000).toISOString().split('T')[0]
    )
  })

  it('rejects invalid interval values', async () => {
    const result = await stripeCreateRecurringInvoiceTool.directExecution?.({
      apiKey: 'sk_test_123',
      customer: 'cus_123',
      amount: 12.34,
      interval: 'decade',
    })

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('interval must be day, week, month, or year')
    expect(createSubscriptionMock).not.toHaveBeenCalled()
  })

  it('rejects non-positive amounts', async () => {
    const result = await stripeCreateRecurringInvoiceTool.directExecution?.({
      apiKey: 'sk_test_123',
      customer: 'cus_123',
      amount: 0,
      interval: 'month',
    })

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('STRIPE_VALIDATION_ERROR')
    expect(createSubscriptionMock).not.toHaveBeenCalled()
  })
})
