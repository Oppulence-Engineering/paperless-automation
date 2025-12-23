import type { BlockConfig, OutputFieldDefinition, ParamConfig, SubBlockConfig } from '@/blocks/types'

const PARAM_TYPE_MAP: Record<string, string> = {
  short_text: 'string',
  long_text: 'string',
  code: 'string',
  json: 'object',
  checkbox: 'boolean',
  slider: 'number',
  dropdown: 'enum',
  file_upload: 'file',
  table: 'array',
  'tool-input': 'object',
  'file-selector': 'file',
  'eval-input': 'string',
}

const OUTPUT_TYPE_MAP: Record<string, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
  any: 'any',
}

const RFC_CATEGORY_KEYWORDS: Record<string, string[]> = {
  email: ['gmail', 'outlook', 'sendgrid', 'mailgun', 'mailchimp', 'smtp', 'ses', 'email'],
  messaging: [
    'slack',
    'discord',
    'telegram',
    'twilio',
    'sms',
    'whatsapp',
    'teams',
    'mattermost',
    'signal',
    'messenger',
  ],
  ai: [
    'openai',
    'anthropic',
    'claude',
    'gemini',
    'vertex',
    'mistral',
    'groq',
    'ollama',
    'llama',
    'deepseek',
    'xai',
    'cohere',
    'perplexity',
    'huggingface',
  ],
  database: [
    'postgres',
    'postgresql',
    'mysql',
    'mariadb',
    'mongodb',
    'mongo',
    'supabase',
    'redis',
    'dynamodb',
    'rds',
    'elasticsearch',
    'pinecone',
    'qdrant',
    'weaviate',
    'milvus',
    'neo4j',
    'bigquery',
    'snowflake',
    'sqlite',
  ],
  crm: ['salesforce', 'hubspot', 'zendesk', 'pipedrive', 'intercom', 'zoho', 'freshdesk'],
  payments: ['stripe', 'paypal', 'braintree', 'square', 'adyen', 'paystack', 'razorpay', 'checkout'],
  storage: [
    's3',
    'gcs',
    'google_drive',
    'drive',
    'dropbox',
    'box',
    'onedrive',
    'sharepoint',
    'sftp',
    'ftp',
    'storage',
  ],
}

export function mapParamType(type: string): string {
  return PARAM_TYPE_MAP[type] ?? type
}

export function mapOutputType(type: string): string {
  return OUTPUT_TYPE_MAP[type] ?? 'any'
}

export function getRequiredInputs(block: BlockConfig): Set<string> {
  const required = new Set<string>()
  for (const subBlock of block.subBlocks) {
    if (isAlwaysRequired(subBlock)) {
      required.add(subBlock.id)
    }
  }
  return required
}

function isAlwaysRequired(subBlock: SubBlockConfig): boolean {
  if (subBlock.required === true) return true
  return false
}

export function buildParamsDescriptor(block: BlockConfig): Record<
  string,
  { type: string; required: boolean; description?: string }
> {
  const required = getRequiredInputs(block)
  const params: Record<string, { type: string; required: boolean; description?: string }> = {}

  for (const [name, config] of Object.entries(block.inputs)) {
    params[name] = {
      type: mapParamType(config.type),
      required: required.has(name),
      description: config.description,
    }
  }

  return params
}

export function buildInputSchema(block: BlockConfig): Record<string, unknown> {
  const required = getRequiredInputs(block)
  const properties: Record<string, unknown> = {}

  for (const [name, config] of Object.entries(block.inputs)) {
    properties[name] = mapParamToSchema(config)
  }

  return {
    type: 'object',
    properties,
    required: required.size > 0 ? Array.from(required) : undefined,
    additionalProperties: false,
  }
}

function mapParamToSchema(config: ParamConfig): Record<string, unknown> {
  if (config.schema) {
    return {
      ...config.schema,
      ...(config.description ? { description: config.description } : {}),
    }
  }

  const type = config.type
  if (type === 'json') {
    return {
      type: 'object',
      additionalProperties: true,
      ...(config.description ? { description: config.description } : {}),
    }
  }

  if (type === 'array') {
    return {
      type: 'array',
      items: {},
      ...(config.description ? { description: config.description } : {}),
    }
  }

  return {
    type: mapParamType(type),
    ...(config.description ? { description: config.description } : {}),
  }
}

export function buildOutputSchema(block: BlockConfig): Record<string, unknown> {
  const properties: Record<string, unknown> = {}

  for (const [name, config] of Object.entries(block.outputs)) {
    if (name === 'visualization') continue
    properties[name] = mapOutputToSchema(config as OutputFieldDefinition)
  }

  return {
    type: 'object',
    properties,
    additionalProperties: true,
  }
}

function mapOutputToSchema(config: OutputFieldDefinition): Record<string, unknown> {
  if (typeof config === 'string') {
    return { type: mapOutputType(config) }
  }

  return {
    type: mapOutputType(config.type),
    ...(config.description ? { description: config.description } : {}),
  }
}

export function getCredentialTypes(block: BlockConfig): string[] {
  if (!block.authMode) return []

  switch (block.authMode) {
    case 'oauth':
      return [`${block.type}_oauth`]
    case 'api_key':
      return [`${block.type}_api_key`]
    case 'bot_token':
      return [`${block.type}_bot_token`]
    default:
      return []
  }
}

export function mapBlockCategory(block: BlockConfig): string {
  const searchSpace = [
    block.type,
    block.name,
    block.description,
    ...block.tools.access,
  ]
    .join(' ')
    .toLowerCase()

  for (const [category, keywords] of Object.entries(RFC_CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => searchSpace.includes(keyword))) {
      return category
    }
  }

  return 'other'
}
