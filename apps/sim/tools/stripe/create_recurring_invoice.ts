import Stripe from 'stripe'
import type {
  CreateRecurringInvoiceParams,
  CreateRecurringInvoiceResponse,
} from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { validateFinancialAmount } from '@/tools/financial-validation'

export const stripeCreateRecurringInvoiceTool: ToolConfig<
  CreateRecurringInvoiceParams,
  CreateRecurringInvoiceResponse
> = {
  id: 'stripe_create_recurring_invoice',
  name: 'Stripe Create Recurring Invoice',
  description:
    'Create recurring invoices for subscription-based billing with automatic scheduling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    customer: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stripe customer ID to invoice',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invoice amount in dollars',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Currency code (default: "usd")',
    },
    interval: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Billing interval: "month", "year", "week", or "day"',
    },
    intervalCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of intervals between invoices (default: 1)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description for the recurring invoice',
    },
    autoAdvance: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Automatically finalize and attempt payment (default: true)',
    },
    daysUntilDue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of days until invoice is due (default: 30)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Creates a recurring subscription so Stripe handles ongoing invoices
   */
  directExecution: async (params) => {
    try {
      const amountValidation = validateFinancialAmount(params.amount, {
        fieldName: 'amount',
        allowNegative: false,
        allowZero: false,
        min: 0.01,
      })

      if (!amountValidation.valid) {
        return {
          success: false,
          output: {},
          error: `STRIPE_VALIDATION_ERROR: ${amountValidation.error}`,
        }
      }

      const interval = params.interval
      const allowedIntervals = new Set(['day', 'week', 'month', 'year'])
      if (!allowedIntervals.has(interval)) {
        return {
          success: false,
          output: {},
          error: 'STRIPE_VALIDATION_ERROR: interval must be day, week, month, or year',
        }
      }

      const intervalCount = params.intervalCount ?? 1
      if (intervalCount < 1) {
        return {
          success: false,
          output: {},
          error: 'STRIPE_VALIDATION_ERROR: intervalCount must be at least 1',
        }
      }

      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      const amountValue = amountValidation.sanitized ?? Number(params.amount)
      const amountCents = Math.round(amountValue * 100)
      const currency = params.currency || 'usd'
      const collectionMethod = params.autoAdvance === false ? 'send_invoice' : 'charge_automatically'

      const subscription = await stripe.subscriptions.create({
        customer: params.customer,
        collection_method: collectionMethod,
        days_until_due:
          collectionMethod === 'send_invoice' ? (params.daysUntilDue ?? 30) : undefined,
        items: [
          {
            price_data: {
              currency,
              recurring: {
                interval,
                interval_count: intervalCount,
              },
              unit_amount: amountCents,
              product_data: {
                name: params.description || `Recurring ${interval} invoice`,
              },
            },
          },
        ],
        metadata: {
          recurring: 'true',
          interval,
          interval_count: String(intervalCount),
        },
        expand: ['latest_invoice'],
      })

      const latestInvoice =
        subscription.latest_invoice && typeof subscription.latest_invoice !== 'string'
          ? subscription.latest_invoice
          : null
      const invoiceId =
        latestInvoice?.id ||
        (typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : '')

      const invoiceCreated = latestInvoice?.created
        ? new Date(latestInvoice.created * 1000).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0]

      const nextInvoiceDate = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : (() => {
            const next = new Date()
            switch (interval) {
              case 'day':
                next.setDate(next.getDate() + intervalCount)
                break
              case 'week':
                next.setDate(next.getDate() + intervalCount * 7)
                break
              case 'month':
                next.setMonth(next.getMonth() + intervalCount)
                break
              case 'year':
                next.setFullYear(next.getFullYear() + intervalCount)
                break
            }
            return next
          })()

      return {
        success: true,
        output: {
          invoice: {
            id: invoiceId,
            customer: subscription.customer as string,
            amount_due: latestInvoice ? latestInvoice.amount_due / 100 : amountValue,
            currency,
            status: latestInvoice?.status || 'draft',
            created: invoiceCreated,
            due_date: latestInvoice?.due_date
              ? new Date(latestInvoice.due_date * 1000).toISOString().split('T')[0]
              : null,
            invoice_pdf: latestInvoice?.invoice_pdf || null,
            hosted_invoice_url: latestInvoice?.hosted_invoice_url || null,
          },
          recurring_schedule: {
            interval,
            interval_count: intervalCount,
            next_invoice_date: nextInvoiceDate.toISOString().split('T')[0],
            estimated_annual_value:
              interval === 'month'
                ? (amountValue * 12) / intervalCount
                : interval === 'year'
                  ? amountValue / intervalCount
                  : interval === 'week'
                    ? (amountValue * 52) / intervalCount
                    : (amountValue * 365) / intervalCount,
          },
          metadata: {
            invoice_id: invoiceId,
            customer_id: subscription.customer as string,
            amount: latestInvoice ? latestInvoice.amount_due / 100 : amountValue,
            status: latestInvoice?.status || 'draft',
            recurring: true,
            interval,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `STRIPE_RECURRING_INVOICE_ERROR: Failed to create recurring invoice - ${errorDetails}`,
      }
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'Created invoice object with payment details and hosted URL',
    },
    recurring_schedule: {
      type: 'json',
      description:
        'Recurring schedule information including next invoice date and annual value',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata including recurring status and interval',
    },
  },
}
