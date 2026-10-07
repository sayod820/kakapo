import { createHash } from 'node:crypto'

export const VERSION = 'r1.6'
export const MAX_OUTPUT_BYTES = 256 * 1024
export const MAX_FILE_BYTES = 128 * 1024
export const MAX_COMMAND_BYTES = 512 * 1024
export const DEFAULT_LOG_LINES = 80
export const MAX_LOG_LINES = 200
export const MAX_LOG_BYTES = 128 * 1024
export const MAX_LOG_LINE_CHARS = 4096
export const DEFAULT_SYNC_LIMIT = 20
export const MAX_SYNC_LIMIT = 100
export const MAX_SEARCH_RESULTS = 10

export const CONTAINERS = Object.freeze({
  api: 'kakapo-api',
  web: 'kakapo-web',
  nginx: 'kakapo-nginx',
  postgres: 'kakapo-postgres',
})

export const PRODUCTION_REPO = '/opt/kakapo-release-online-v1.0.0'

export const EXECUTABLES = Object.freeze({
  docker: '/usr/bin/docker',
  git: '/usr/bin/git',
  curl: '/usr/bin/curl',
  uptime: '/usr/bin/uptime',
  free: '/usr/bin/free',
  df: '/usr/bin/df',
  uname: '/usr/bin/uname',
  hostname: '/bin/hostname',
})

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ENTITY_TYPES = new Set([
  'sale', 'shift', 'product', 'client', 'card', 'category', 'receipt',
  'writeoff', 'revision', 'finance_move', 'expense', 'supplier', 'pos_point',
  'cashier', 'order',
])

export class PolicyError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'PolicyError'
    this.code = code
  }
}

function exactArgs(args, min, max = min) {
  if (args.length < min || args.length > max) {
    throw new PolicyError('INVALID_ARGUMENT_COUNT')
  }
}

export function boundedInt(value, { min, max, fallback }) {
  if (value == null || value === '') return fallback
  if (!/^[0-9]+$/.test(String(value))) throw new PolicyError('INVALID_INTEGER')
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new PolicyError('INTEGER_OUT_OF_RANGE')
  }
  return n
}

export function validateIdentifier(value, label = 'identifier') {
  const text = String(value || '')
  if (!ID_RE.test(text)) throw new PolicyError('INVALID_IDENTIFIER', `Invalid ${label}`)
  return text
}

export function validateProductId(value) {
  return boundedInt(value, { min: 1, max: 2_147_483_647 })
}

export function validateSaleNumber(value) {
  return boundedInt(value, { min: 1, max: 9_999_999_999 })
}

export function normalizePhone(value) {
  const raw = String(value || '').trim()
  if (!/^[+()\-\s0-9]+$/.test(raw)) throw new PolicyError('INVALID_PHONE')
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('992')) digits = digits.slice(3)
  if (digits.length !== 9) throw new PolicyError('INVALID_PHONE')
  return digits
}

export function normalizeCard(value) {
  const raw = String(value || '').trim()
  const withoutPrefix = raw.replace(/^(?:KAKAPO|\u041a\u0410\u041a\u0410\u041f\u041e)[\s_-]*/iu, '')
  if (!/^[0-9\s-]+$/.test(withoutPrefix)) throw new PolicyError('INVALID_CARD')
  const digits = withoutPrefix.replace(/\D/g, '')
  if (!digits || digits.length > 16) throw new PolicyError('INVALID_CARD')
  return digits.replace(/^0+(?=\d)/, '')
}

export function validateSearch(value) {
  const text = String(value || '').normalize('NFKC').trim()
  if (text.length < 3 || text.length > 80 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new PolicyError('INVALID_SEARCH')
  }
  return text
}

function validateRawArg(value) {
  const text = String(value)
  if (!text || text.startsWith('-') || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new PolicyError('INVALID_ARGUMENT')
  }
  return text
}

export function parseCommand(argv) {
  const args = [...argv]
  if (!args.length) throw new PolicyError('COMMAND_REQUIRED')
  args.forEach(validateRawArg)
  const command = args.shift()

  if (['status', 'disk', 'memory', 'load'].includes(command)) {
    exactArgs(args, 0)
    return { kind: 'server', command }
  }

  if (['git-head', 'git-status', 'git-tag'].includes(command)) {
    exactArgs(args, 0)
    return { kind: 'git', command }
  }
  if (command === 'git-log') {
    exactArgs(args, 0, 1)
    return { kind: 'git', command, limit: boundedInt(args[0], { min: 1, max: 50, fallback: 10 }) }
  }

  if (command === 'containers') {
    exactArgs(args, 0)
    return { kind: 'docker', command }
  }
  if (command === 'container-health') {
    exactArgs(args, 1)
    if (!CONTAINERS[args[0]]) throw new PolicyError('INVALID_CONTAINER')
    return { kind: 'docker', command, target: args[0] }
  }

  if (command === 'logs') {
    exactArgs(args, 1, 2)
    const target = args[0]
    if (!CONTAINERS[target]) throw new PolicyError('INVALID_CONTAINER')
    const lines = boundedInt(args[1], { min: 1, max: MAX_LOG_LINES, fallback: DEFAULT_LOG_LINES })
    return { kind: 'logs', target, lines }
  }

  if (command === 'nginx-status' || command === 'nginx-config-summary') {
    exactArgs(args, 0)
    return { kind: 'nginx', command }
  }

  if (['health', 'ready', 'web'].includes(command)) {
    exactArgs(args, 0)
    return { kind: 'http', command }
  }

  const oneId = new Set(['client', 'debt', 'sale', 'order', 'shift', 'finance'])
  if (oneId.has(command)) {
    exactArgs(args, 1)
    return { kind: 'db', command, args: [validateIdentifier(args[0])] }
  }
  if (command === 'client-phone') {
    exactArgs(args, 1)
    return { kind: 'db', command, args: [normalizePhone(args[0])] }
  }
  if (command === 'client-search') {
    exactArgs(args, 1)
    return { kind: 'db', command, args: [validateSearch(args[0])] }
  }
  if (command === 'card') {
    exactArgs(args, 1)
    return { kind: 'db', command, args: [normalizeCard(args[0])] }
  }
  if (command === 'sale-number') {
    exactArgs(args, 1)
    return { kind: 'db', command, args: [validateSaleNumber(args[0])] }
  }
  if (command === 'product') {
    exactArgs(args, 1)
    return { kind: 'db', command, args: [validateProductId(args[0])] }
  }
  if (command === 'sync-head') {
    exactArgs(args, 0)
    return { kind: 'db', command, args: [] }
  }
  if (command === 'sync-entity') {
    exactArgs(args, 2, 3)
    const entityType = args[0]
    if (!ENTITY_TYPES.has(entityType)) throw new PolicyError('INVALID_ENTITY_TYPE')
    const entityId = validateIdentifier(args[1], 'entity id')
    const limit = boundedInt(args[2], { min: 1, max: MAX_SYNC_LIMIT, fallback: DEFAULT_SYNC_LIMIT })
    return { kind: 'db', command, args: [entityType, entityId, limit] }
  }

  throw new PolicyError('COMMAND_NOT_ALLOWED')
}

export function redactText(value) {
  let text = String(value ?? '')
  text = text.replace(/(Authorization\s*[:=]\s*(?:Bearer\s+)?)[^\s,"'}]+/gi, '$1[REDACTED]')
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
  text = text.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{5,})?/g, '[JWT_REDACTED]')
  text = text.replace(/(["']?(?:password|passwd|pwd|token|access_?token|refresh_?token|session(?:_?id|_?token)?|api_?key|otp|pin|pair(?:ing)?_?(?:code|secret)|device_?(?:key|secret|token)|database_url|postgres_password)["']?\s*[:=]\s*)["']?[^\s,;"'}]+["']?/gi, '$1[REDACTED]')
  text = text.replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
  text = text.replace(/((?:Server|Host|User ID|Uid|Password|Pwd)\s*=\s*)[^;\r\n]+/gi, '$1[REDACTED]')
  text = text.replace(/((?:Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
  text = text.replace(/\+?992[\s()-]*\d{2}[\s()-]*\d{3}[\s()-]*\d{2}[\s()-]*\d{2}/g, '+992 ** *** ** **')
  text = text.replace(/(?<!\d)(?:\d[\s()-]*){9}(?!\d)/g, '***PHONE***')
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]')
  return text
}

export function redactLogLine(value) {
  const source = String(value ?? '').slice(0, MAX_LOG_LINE_CHARS)
  if (/-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH KEY)-----/i.test(source)) return '[REDACTED]'
  const redacted = redactText(source)
  const unresolved = /(?:password|passwd|pwd|token|secret|api.?key|authorization|cookie|otp|pin|database.?url)\s*[:=]\s*["']?(?!\[REDACTED\])\S+/i
  return unresolved.test(redacted) ? '[REDACTED]' : redacted
}

export function redactLogOutput(value, maxLines = MAX_LOG_LINES, maxBytes = MAX_LOG_BYTES) {
  const allLines = String(value ?? '').split(/\r?\n/)
  const sourceLines = allLines.slice(0, maxLines)
  let truncated = allLines.length > sourceLines.length
    || sourceLines.some(line => line.length > MAX_LOG_LINE_CHARS)
  const lines = sourceLines.map(redactLogLine)
  let output = lines.join('\n')
  while (lines.length && Buffer.byteLength(output, 'utf8') > maxBytes - 32) {
    truncated = true
    lines.pop()
    output = lines.join('\n')
  }
  if (truncated) {
    output = `${output}${output ? '\n' : ''}[TRUNCATED]`
  }
  return output
}

export function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return null
  return `***${digits.slice(-2)}`
}

export function maskEmail(value) {
  const text = String(value || '').trim()
  const at = text.indexOf('@')
  if (at < 1) return text ? '[REDACTED]' : null
  return `${text[0]}***@${text.slice(at + 1)}`
}

export function maskCard(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits ? `****${digits.slice(-4)}` : null
}

export function fingerprint(value) {
  if (value == null || value === '') return null
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

function numberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function bool(value) {
  return value === true
}

export function projectClient(data = {}) {
  const ledger = Array.isArray(data.debtLedger) ? data.debtLedger : []
  const remaining = ledger.reduce((sum, entry) => sum + Math.max(0, Number(entry?.remaining) || 0), 0)
  return {
    id: data.id ?? null,
    name: data.name ?? null,
    phone: maskPhone(data.phone),
    email: maskEmail(data.email),
    card: maskCard(data.card),
    level: data.level ?? null,
    orders: numberOrNull(data.orders),
    spent: numberOrNull(data.spent),
    debt: numberOrNull(data.debt),
    debtLedgerRemaining: remaining,
    debtLedgerEntries: ledger.length,
    bonus: numberOrNull(data.bonus),
    wallet: numberOrNull(data.wallet),
    debtLimit: numberOrNull(data.debtLimit),
    blocked: bool(data.blocked),
    vip: bool(data.vip),
    debtEnabled: bool(data.debtEnabled),
    debtOverdueStrikes: numberOrNull(data.debtOverdueStrikes),
    debtCreditBlocked: bool(data.debtCreditBlocked),
    accountStatus: data.accountStatus ?? null,
    accountGeneration: numberOrNull(data.accountGeneration),
    docVersion: numberOrNull(data.docVersion),
    updatedAtIso: data.updatedAtIso ?? data.serverAtIso ?? null,
    notePresent: Boolean(data.note),
  }
}

export function projectCard(data = {}) {
  const ledger = Array.isArray(data.debtLedger) ? data.debtLedger : []
  return {
    num: maskCard(data.num),
    clientId: data.clientId ?? null,
    client: data.client ?? null,
    phone: maskPhone(data.phone),
    status: data.status ?? null,
    level: data.level ?? null,
    bonus: numberOrNull(data.bonus),
    wallet: numberOrNull(data.wallet),
    debt: numberOrNull(data.debt),
    debtLimit: numberOrNull(data.debtLimit),
    debtLedgerEntries: ledger.length,
    debtPayVersion: numberOrNull(data.debtPayVersion),
    bonusPayVersion: numberOrNull(data.bonusPayVersion),
    vip: bool(data.vip),
    debtEnabled: bool(data.debtEnabled),
    debtOverdueStrikes: numberOrNull(data.debtOverdueStrikes),
    debtCreditBlocked: bool(data.debtCreditBlocked),
    updatedAtIso: data.updatedAtIso ?? data.serverAtIso ?? null,
    notePresent: Boolean(data.note),
  }
}

export function projectDebtEntry(entry = {}) {
  return {
    id: entry.id ?? null,
    amount: numberOrNull(entry.amount),
    remaining: numberOrNull(entry.remaining),
    source: entry.source ?? null,
    saleId: entry.saleId ?? null,
    orderId: entry.orderId ?? null,
    createdAtIso: entry.createdAtIso ?? null,
    dueAtIso: entry.dueAtIso ?? null,
    clientRefFingerprint: fingerprint(entry.clientRef),
    descPresent: Boolean(entry.desc),
    createdNotified: bool(entry.createdNotified),
    reminderNotified: bool(entry.reminderNotified),
    overdueNotified: bool(entry.overdueNotified),
    overdueStrikeApplied: bool(entry.overdueStrikeApplied),
  }
}

export function projectSale(data = {}) {
  return {
    id: data.id ?? null,
    number: numberOrNull(data.number),
    createdAtIso: data.createdAtIso ?? null,
    status: data.status ?? null,
    posId: data.posId ?? null,
    shiftId: data.shiftId ?? null,
    orderId: data.orderId ?? null,
    clientId: data.clientId ?? null,
    clientName: data.clientName ?? null,
    clientPhone: maskPhone(data.clientPhone),
    cardNum: maskCard(data.cardNum),
    paymentMethod: data.paymentMethod ?? null,
    total: numberOrNull(data.total),
    paidCash: numberOrNull(data.paidCash),
    paidCard: numberOrNull(data.paidCard),
    paidWallet: numberOrNull(data.paidWallet),
    debtAdded: numberOrNull(data.debtAdded),
    discountAmount: numberOrNull(data.discountAmount),
    bonusSpent: numberOrNull(data.bonusSpent),
    bonusEarned: numberOrNull(data.bonusEarned),
    clientRefFingerprint: fingerprint(data.clientRef),
    notePresent: Boolean(data.note),
    items: (Array.isArray(data.items) ? data.items : []).slice(0, 100).map(item => ({
      productId: item?.productId ?? null,
      productName: item?.productName ?? null,
      qty: numberOrNull(item?.qty),
      price: numberOrNull(item?.price),
      lineTotal: numberOrNull(item?.lineTotal),
      returnedQty: numberOrNull(item?.returnedQty),
    })),
    returns: (Array.isArray(data.returns) ? data.returns : []).slice(0, 50).map(ret => ({
      atIso: ret?.atIso ?? null,
      total: numberOrNull(ret?.total),
      cutCash: numberOrNull(ret?.cutCash),
      cutCard: numberOrNull(ret?.cutCard),
      cutDebt: numberOrNull(ret?.cutDebt),
      itemCount: Array.isArray(ret?.items) ? ret.items.length : 0,
      notePresent: Boolean(ret?.note),
    })),
  }
}

export function projectOrder(data = {}) {
  const client = data.client && typeof data.client === 'object' ? data.client : {}
  return {
    id: data.id ?? null,
    type: data.type ?? null,
    status: data.status ?? null,
    channel: data.channel ?? null,
    createdAtIso: data.createdAtIso ?? data.createdAt ?? null,
    deliveredAtIso: data.deliveredAtIso ?? data.deliveredAt ?? null,
    clientAccountId: data.clientAccountId ?? null,
    accountGeneration: numberOrNull(data.accountGeneration),
    client: { name: client.name ?? null, phone: maskPhone(client.phone), addressPresent: Boolean(client.addr) },
    paymentMethod: data.payment_method ?? data.pay ?? null,
    total: numberOrNull(data.total),
    goodsTotal: numberOrNull(data.goodsTotal),
    creditAmount: numberOrNull(data.creditAmount),
    paidCash: numberOrNull(data.paidCash),
    paidCard: numberOrNull(data.paidCard),
    bonusSpent: numberOrNull(data.bonusSpent),
    bonusEarned: numberOrNull(data.bonusEarned),
    posSaleId: data.posSaleId ?? null,
    posSaleClientRefFingerprint: fingerprint(data.posSaleClientRef),
    commentPresent: Boolean(data.comment),
    assemblerNotePresent: Boolean(data.assemblerNote),
    itemCount: Array.isArray(data.items) ? data.items.length : 0,
    items: (Array.isArray(data.items) ? data.items : []).slice(0, 100).map(item => ({
      id: item?.id ?? null,
      art: item?.art ?? null,
      name: item?.name ?? null,
      qty: numberOrNull(item?.qty ?? item?.q),
      unit: item?.unit ?? null,
      price: numberOrNull(item?.price ?? item?.p),
      source: item?.source ?? null,
      restId: item?.restId ?? null,
    })),
  }
}

export function projectShift(data = {}) {
  return {
    id: data.id ?? null,
    posId: data.posId ?? null,
    cashierId: data.cashierId ?? null,
    cashierName: data.cashierName ?? null,
    openedAtIso: data.openedAtIso ?? null,
    closedAtIso: data.closedAtIso ?? null,
    status: data.status ?? null,
    openingCash: numberOrNull(data.openingCash),
    closingCash: numberOrNull(data.closingCash),
    expectedCash: numberOrNull(data.expectedCash),
    actualCash: numberOrNull(data.actualCash),
    cashDiff: numberOrNull(data.cashDiff),
    expectedCard: numberOrNull(data.expectedCard),
    actualCard: numberOrNull(data.actualCard),
    cardDiff: numberOrNull(data.cardDiff),
    salesCash: numberOrNull(data.salesCash),
    salesCard: numberOrNull(data.salesCard),
    salesCredit: numberOrNull(data.salesCredit),
    salesCount: numberOrNull(data.salesCount),
    debtRepayCash: numberOrNull(data.debtRepayCash),
    expenseTotal: numberOrNull(data.expenseTotal),
    cashInTotal: numberOrNull(data.cashInTotal),
    clientRefFingerprint: fingerprint(data.clientRef),
    notePresent: Boolean(data.note),
    reconcileNotePresent: Boolean(data.reconcileNote),
  }
}

export function projectFinance(data = {}, collection) {
  return {
    collection,
    id: data.id ?? null,
    type: data.type ?? null,
    createdAtIso: data.createdAtIso ?? null,
    amount: numberOrNull(data.amount),
    signedAmount: numberOrNull(data.signedAmount),
    direction: data.direction ?? null,
    cashAffect: data.cashAffect === true,
    method: data.method ?? null,
    payFrom: data.payFrom ?? null,
    posId: data.posId ?? null,
    shiftId: data.shiftId ?? null,
    refType: data.refType ?? null,
    refId: data.refId ?? null,
    reason: data.reason ?? null,
    cardNum: maskCard(data.cardNum),
    clientRefFingerprint: fingerprint(data.clientRef),
    balanceAfter: numberOrNull(data.balanceAfter),
    notePresent: Boolean(data.note),
    metaPresent: Boolean(data.meta),
  }
}

export function projectProduct(data = {}) {
  return {
    id: data.id ?? null,
    art: data.art ?? null,
    name: data.name ?? null,
    price: numberOrNull(data.price),
    category: data.cat ?? null,
    categoryId: data.catId ?? null,
    unit: data.unit ?? null,
    stock: numberOrNull(data.stock),
    barcode: data.barcode ?? null,
    barcodes: Array.isArray(data.barcodes) ? data.barcodes.slice(0, 20) : [],
    plu: data.plu ?? null,
    sellType: data.sellType ?? null,
    discount: numberOrNull(data.discount),
    docVersion: numberOrNull(data.docVersion),
    updatedAtIso: data.updatedAtIso ?? data.serverAtIso ?? null,
    descriptionPresent: Boolean(data.desc),
    photoPresent: Boolean(data.photo || data.photoThumb),
  }
}

export function safeJson(value) {
  let json = JSON.stringify(value, null, 2)
  if (Buffer.byteLength(json, 'utf8') <= MAX_OUTPUT_BYTES) return json
  json = JSON.stringify({ ok: false, error: 'OUTPUT_LIMIT_EXCEEDED', truncated: true }, null, 2)
  return json
}
