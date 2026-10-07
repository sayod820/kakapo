/**
 * KAKAPO full server read access R1.6 security tests.
 * Local/mock only. No SSH, Docker, sudo, PostgreSQL, production, or repo reports.
 * Run: node scripts/kakapo-server-read-security-test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_LOG_BYTES,
  MAX_LOG_LINES,
  MAX_OUTPUT_BYTES,
  PolicyError,
  parseCommand,
  projectClient,
  projectSale,
  redactLogOutput,
  redactText,
  safeJson,
} from '../deploy/hetzner/kakapo-server-read/policy.mjs'
import {
  SQL,
  assertRuntimeSqlIsReadOnly,
  executeInspection,
  resolveInspectorDatabaseUrl,
  runDatabaseCommand,
} from '../deploy/hetzner/kakapo-server-read/db.mjs'
import {
  executeCommand,
  extractPostgresContainerIp,
  runFixed,
  sanitizeContainerInspect,
} from '../deploy/hetzner/kakapo-server-read/cli.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const read = relative => fs.readFile(path.join(root, relative), 'utf8')
let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed++
    console.error(`FAIL  ${name}`)
    console.error(`      ${error?.stack || error}`)
  }
}

function rejects(argv) {
  assert.throws(() => parseCommand(argv), PolicyError)
}

function safeGuardRows(text) {
  if (text === SQL.sessionCheck) {
    return [{ role: 'kakapo_inspector', database: 'kakapo', read_only: 'on', default_read_only: 'on' }]
  }
  if (text === SQL.roleGuard) {
    return [{
      rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false,
      rolreplication: false, rolbypassrls: false, rolcanlogin: true,
      has_membership: false, owns_objects: false,
    }]
  }
  if (text === SQL.privilegeGuard) {
    return [{
      database_create: false, database_temp: false, direct_docs_select: false,
      api_sessions_select: false, kv_meta_select: false,
      writable_relations: 0, writable_sequences: 0, writable_schemas: 0,
    }]
  }
  if (text === SQL.functionGuard) return [{ executable_count: 0 }]
  if (text === SQL.syncHead) return [{ row_count: '0' }]
  return []
}

function mockPool(overrides = {}) {
  const calls = []
  const client = {
    query: async (text, params = []) => {
      calls.push({ text, params })
      const rows = Object.prototype.hasOwnProperty.call(overrides, text)
        ? overrides[text]
        : safeGuardRows(text)
      return { rows }
    },
    release: () => {},
  }
  return { calls, client, pool: { connect: async () => client, end: async () => {} } }
}

const dbConfig = {
  databaseUrl: 'postgresql://kakapo_inspector:test-fixture@kakapo-postgres:5432/kakapo',
}

await test('fixed top-level command allowlist is accepted', () => {
  for (const command of [
    'status', 'disk', 'memory', 'load', 'git-head', 'git-status', 'git-tag',
    'containers', 'nginx-status', 'nginx-config-summary', 'health', 'ready', 'web',
    'sync-head',
  ]) assert.equal(parseCommand([command]).command, command)
  assert.equal(parseCommand(['git-log', '12']).limit, 12)
  assert.equal(parseCommand(['container-health', 'api']).target, 'api')
})

await test('generic file/root/read/environment commands do not exist', () => {
  for (const argv of [
    ['file', 'source', 'README.md'], ['read', '/etc/shadow'], ['cat', '/etc/passwd'],
    ['release', 'source'], ['env'], ['config'], ['git', 'status'], ['docker', 'ps'],
  ]) rejects(argv)
})

await test('server, Git, nginx, and HTTP commands accept no path argument', () => {
  for (const command of [
    'status', 'disk', 'memory', 'load', 'git-head', 'git-status', 'git-tag',
    'nginx-status', 'nginx-config-summary', 'health', 'ready', 'web',
  ]) rejects([command, '../../etc/shadow'])
})

await test('path traversal and symlink surfaces are absent from runtime source', async () => {
  const policy = await read('deploy/hetzner/kakapo-server-read/policy.mjs')
  const cli = await read('deploy/hetzner/kakapo-server-read/cli.mjs')
  assert(!/readApprovedFile|validateRelativePath|realpath|readFile|readdir|lstat/.test(policy))
  assert(!/readApprovedFile|realpath|readFile|readdir|\/etc\/nginx/.test(cli))
  assert(!/kind === ['"]file['"]|command === ['"]file['"]/.test(`${policy}\n${cli}`))
})

await test('secret files cannot be requested because no path command exists', () => {
  for (const value of ['.env', 'id_rsa', 'server.key', 'credentials.json', 'private.pem']) {
    rejects(['file', 'release', value])
    rejects(['nginx-config-summary', value])
  }
})

await test('Git reads are fixed and bounded', () => {
  assert.equal(parseCommand(['git-log']).limit, 10)
  assert.equal(parseCommand(['git-log', '50']).limit, 50)
  rejects(['git-log', '51'])
  rejects(['git-log', '--all'])
  rejects(['git-head', 'other-repo'])
})

await test('Docker container allowlist is exact', () => {
  for (const target of ['api', 'web', 'nginx', 'postgres']) {
    assert.equal(parseCommand(['container-health', target]).target, target)
    assert.equal(parseCommand(['logs', target]).target, target)
  }
  rejects(['container-health', 'certbot'])
  rejects(['logs', 'other'])
})

await test('Docker write/exec verbs have no command path', () => {
  for (const verb of ['exec', 'run', 'compose', 'restart', 'stop', 'rm', 'down', 'volume', 'prune', 'image']) {
    rejects([verb, 'api'])
    rejects(['docker', verb, 'api'])
  }
})

await test('logs are line-bounded and use fixed Docker argv', async () => {
  assert.equal(parseCommand(['logs', 'api', String(MAX_LOG_LINES)]).lines, MAX_LOG_LINES)
  rejects(['logs', 'api', String(MAX_LOG_LINES + 1)])
  let captured
  await executeCommand(parseCommand(['logs', 'api', '25']), {
    execFile: async (file, args, options) => {
      captured = { file, args, options }
      return { stdout: 'ok', stderr: '' }
    },
  })
  assert.equal(captured.file, '/usr/bin/docker')
  assert.deepEqual(captured.args, ['logs', '--tail', '25', '--since', '30m', 'kakapo-api'])
  assert.equal(captured.options.shell, false)
})

await test('runFixed has no shell and does not inherit caller environment', async () => {
  let captured
  await runFixed('/usr/bin/git', ['--version'], {
    execFile: async (file, args, options) => {
      captured = { file, args, options }
      return { stdout: 'git version', stderr: '' }
    },
  })
  assert.equal(captured.options.shell, false)
  assert.deepEqual(Object.keys(captured.options.env).sort(), ['LANG', 'LC_ALL', 'PATH'])
})

await test('Docker inspect output cannot expose environment/mounts/commands', () => {
  const projected = sanitizeContainerInspect([{
    Id: '1234567890abcdef', Name: '/kakapo-api', Created: 'now',
    Config: { Image: 'api:sha', Env: ['DATABASE_URL=fixture'], Cmd: ['/bin/sh'], Labels: { secret: 'x' } },
    Mounts: [{ Source: '/root/private' }],
    State: { Status: 'running', Running: true, Health: { Status: 'healthy', Log: [] } },
  }], 'kakapo-api')
  const json = JSON.stringify(projected)
  assert(!/DATABASE_URL|\/root\/private|Labels|\/bin\/sh/.test(json))
})

await test('DB host is fixed private kakapo-net metadata', () => {
  const ip = extractPostgresContainerIp([{
    Name: '/kakapo-postgres',
    NetworkSettings: { Networks: { 'kakapo-net': { IPAddress: '172.19.0.2' } } },
  }])
  assert.equal(new URL(resolveInspectorDatabaseUrl(dbConfig.databaseUrl, ip)).hostname, ip)
  assert.throws(() => resolveInspectorDatabaseUrl(dbConfig.databaseUrl, '46.225.92.161'), PolicyError)
  assert.throws(() => resolveInspectorDatabaseUrl(
    'postgresql://kakapo:test@kakapo-postgres:5432/kakapo', ip,
  ), PolicyError)
})

await test('DB command uses Docker inspect only', async () => {
  const dockerCalls = []
  const mocked = mockPool()
  await executeCommand(parseCommand(['sync-head']), {
    execFile: async (file, args) => {
      dockerCalls.push({ file, args })
      return {
        stdout: JSON.stringify([{
          Name: '/kakapo-postgres',
          NetworkSettings: { Networks: { 'kakapo-net': { IPAddress: '172.19.0.2' } } },
        }]),
        stderr: '',
      }
    },
    db: { config: dbConfig, poolFactory: async () => mocked.pool },
  })
  assert.deepEqual(dockerCalls, [{ file: '/usr/bin/docker', args: ['inspect', 'kakapo-postgres'] }])
})

await test('structured and text credentials are redacted', () => {
  const input = [
    'Authorization: Bearer abc.def.ghi',
    '{"password":"hunter2","accessToken":"token-value","refresh_token":"refresh-value"}',
    'Cookie: sid=private; theme=x',
    'DATABASE_URL=postgresql://user:pass@db/kakapo',
    'Server=db;User ID=admin;Password=private;',
    'otp=123456 pin: 9876 pairing_secret=device-secret',
  ].join('\n')
  const output = redactLogOutput(input)
  for (const secret of ['abc.def.ghi', 'hunter2', 'token-value', 'refresh-value', 'sid=private', 'user:pass', '123456', '9876', 'device-secret']) {
    assert(!output.includes(secret), secret)
  }
})

await test('phones and emails are redacted', () => {
  const output = redactText('phone +992 90 123 45 67 local 901234567 email person@example.com')
  assert(!output.includes('123 45 67'))
  assert(!output.includes('901234567'))
  assert(!output.includes('person@example.com'))
})

await test('log output respects line and byte caps', () => {
  const output = redactLogOutput(Array.from({ length: 500 }, (_, i) => `${i} ${'x'.repeat(5000)}`).join('\n'))
  assert(output.split('\n').length <= MAX_LOG_LINES + 1)
  assert(Buffer.byteLength(output, 'utf8') <= MAX_LOG_BYTES)
  assert(output.includes('[TRUNCATED]'))
})

await test('runtime SQL is fixed SELECT-only and excludes forbidden stores', () => {
  assert.equal(assertRuntimeSqlIsReadOnly(), true)
  for (const text of Object.values(SQL)) {
    assert.match(text, /^\s*SELECT\b/i)
    const executable = text.replace(/'(?:''|[^'])*'/g, "''").replace(/--[^\r\n]*/g, '')
    assert(!/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|CALL|DO)\b/i.test(executable))
    assert(!executable.includes(';'))
  }
  assert(!Object.values(SQL).some(text => /FROM\s+public\.(?:api_sessions|kv_meta)\b/i.test(text)))
})

await test('caller values remain SQL parameters', async () => {
  const calls = []
  await executeInspection({
    query: async (text, params = []) => {
      calls.push({ text, params })
      return { rows: [] }
    },
  }, { command: 'sale', args: ['S-123'] })
  assert.equal(calls.length, 1)
  assert(!calls[0].text.includes('S-123'))
  assert.deepEqual(calls[0].params, ['S-123'])
})

await test('business projections omit raw private and cost fields', () => {
  const json = JSON.stringify({
    client: projectClient({
      id: 'U-03', phone: '+992901234567', email: 'a@example.test', addr: 'private',
      addresses: [{ lat: 1 }], passwordHash: 'fixture-hash', sessionToken: 'fixture-token',
      debtLedger: [],
    }),
    sale: projectSale({
      id: 'S-1', clientPhone: '+992901234567', clientRef: 'op-private',
      items: [{ productId: 1, unitCost: 2, lineCost: 2 }],
    }),
  })
  assert(!/private|passwordHash|sessionToken|unitCost|lineCost|901234567/.test(json))
})

await test('DB transaction verifies read-only defaults and always rolls back', async () => {
  const mocked = mockPool()
  const result = await runDatabaseCommand(
    { command: 'sync-head', args: [] },
    { config: dbConfig, containerIp: '172.19.0.2', poolFactory: async () => mocked.pool },
  )
  assert.equal(result.readOnly, true)
  assert(mocked.calls.some(call => /BEGIN[\s\S]*READ ONLY/.test(call.text)))
  assert(mocked.calls.some(call => call.text === SQL.roleGuard))
  assert(mocked.calls.some(call => call.text === SQL.privilegeGuard))
  assert(mocked.calls.some(call => call.text === SQL.functionGuard))
  assert.equal(mocked.calls.at(-1).text, 'ROLLBACK')
})

await test('DB rejects wrong role or writable transaction', async () => {
  const mocked = mockPool({
    [SQL.sessionCheck]: [{ role: 'kakapo', database: 'kakapo', read_only: 'off', default_read_only: 'off' }],
  })
  await assert.rejects(
    runDatabaseCommand({ command: 'sync-head', args: [] }, {
      config: dbConfig, containerIp: '172.19.0.2', poolFactory: async () => mocked.pool,
    }),
    error => error instanceof PolicyError && error.code === 'READ_ONLY_SESSION_NOT_PROVEN',
  )
  assert.equal(mocked.calls.at(-1).text, 'ROLLBACK')
})

await test('DB rejects BYPASSRLS or unexpected membership', async () => {
  const mocked = mockPool({
    [SQL.roleGuard]: [{
      rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false,
      rolreplication: false, rolbypassrls: true, rolcanlogin: true,
      has_membership: true, owns_objects: true,
    }],
  })
  await assert.rejects(
    runDatabaseCommand({ command: 'sync-head', args: [] }, {
      config: dbConfig, containerIp: '172.19.0.2', poolFactory: async () => mocked.pool,
    }),
    error => error instanceof PolicyError && error.code === 'INSPECTOR_ROLE_GUARD_FAILED',
  )
})

await test('DB rejects TEMP, forbidden reads, or any write privilege', async () => {
  const mocked = mockPool({
    [SQL.privilegeGuard]: [{
      database_create: false, database_temp: true, direct_docs_select: false,
      api_sessions_select: false, kv_meta_select: false,
      writable_relations: 1, writable_sequences: 1, writable_schemas: 0,
    }],
  })
  await assert.rejects(
    runDatabaseCommand({ command: 'sync-head', args: [] }, {
      config: dbConfig, containerIp: '172.19.0.2', poolFactory: async () => mocked.pool,
    }),
    error => error instanceof PolicyError && error.code === 'INSPECTOR_PRIVILEGE_GUARD_FAILED',
  )
})

await test('DB rejects executable non-system functions', async () => {
  const mocked = mockPool({ [SQL.functionGuard]: [{ executable_count: 1 }] })
  await assert.rejects(
    runDatabaseCommand({ command: 'sync-head', args: [] }, {
      config: dbConfig, containerIp: '172.19.0.2', poolFactory: async () => mocked.pool,
    }),
    error => error instanceof PolicyError && error.code === 'INSPECTOR_FUNCTION_GUARD_FAILED',
  )
})

await test('global JSON output is bounded', () => {
  const output = safeJson({ data: 'x'.repeat(MAX_OUTPUT_BYTES * 2) })
  assert(Buffer.byteLength(output, 'utf8') <= MAX_OUTPUT_BYTES)
  assert.match(output, /OUTPUT_LIMIT_EXCEEDED/)
})

await test('role SQL requires every non-privileged role attribute including NOBYPASSRLS', async () => {
  const sql = await read('deploy/hetzner/kakapo-server-read-role.sql')
  assert.match(sql, /NOSUPERUSER[\s\S]*NOCREATEDB[\s\S]*NOCREATEROLE[\s\S]*NOINHERIT[\s\S]*NOREPLICATION[\s\S]*NOBYPASSRLS/)
  assert.match(sql, /rolbypassrls/)
  assert.match(sql, /CONNECTION LIMIT 2/)
})

await test('role SQL fails closed on memberships, ownership, and default grants', async () => {
  const sql = await read('deploy/hetzner/kakapo-server-read-role.sql')
  assert.match(sql, /pg_auth_members[\s\S]*unexpected kakapo_inspector role membership/)
  assert.match(sql, /pg_stat_activity[\s\S]*active pre-existing kakapo_inspector session detected/)
  assert.match(sql, /PASSWORD NULL/)
  assert.match(sql, /unexpectedly owns database objects/)
  assert.match(sql, /pg_shdepend[\s\S]*deptype = 'o'/)
  assert.match(sql, /final ownership verification failed/)
  assert.match(sql, /pg_default_acl[\s\S]*unexpected default privileges/)
})

await test('role SQL denies TEMP while preserving other current LOGIN roles', async () => {
  const sql = await read('deploy/hetzner/kakapo-server-read-role.sql')
  assert.match(sql, /WHERE rolcanlogin[\s\S]*rolname <> 'kakapo_inspector'[\s\S]*has_database_privilege\(oid, 'kakapo', 'TEMP'\)/)
  assert.match(sql, /REVOKE TEMPORARY ON DATABASE kakapo FROM PUBLIC/)
  assert.match(sql, /REVOKE TEMPORARY ON DATABASE kakapo FROM kakapo_inspector/)
})

await test('role SQL denies api_sessions, kv_meta, base docs, and write grants', async () => {
  const sql = await read('deploy/hetzner/kakapo-server-read-role.sql')
  const executable = sql.replace(/--[^\r\n]*/g, '')
  assert.match(sql, /public\.kv_meta, public\.api_sessions FROM kakapo_inspector/)
  assert.match(sql, /has_table_privilege\('kakapo_inspector', 'public\.api_sessions', 'SELECT'\)/)
  assert.match(sql, /has_table_privilege\('kakapo_inspector', 'public\.kv_meta', 'SELECT'\)/)
  assert.match(sql, /has_sequence_privilege\('kakapo_inspector', c\.oid, 'USAGE'\)/)
  assert.match(SQL.privilegeGuard, /has_sequence_privilege\(current_user, c\.oid, 'UPDATE'\)/)
  assert(!/GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|ALL)\b/i.test(executable))
})

await test('SECURITY DEFINER/function guard fails closed without global PUBLIC EXECUTE changes', async () => {
  const sql = await read('deploy/hetzner/kakapo-server-read-role.sql')
  assert.match(sql, /pg_proc[\s\S]*has_function_privilege\('kakapo_inspector', p\.oid, 'EXECUTE'\)/)
  assert.match(sql, /executable non-system function visible to kakapo_inspector/)
  assert(!/REVOKE\s+EXECUTE[\s\S]*FROM\s+PUBLIC/i.test(sql))
  assert.match(SQL.functionGuard, /has_function_privilege\(current_user, p\.oid, 'EXECUTE'\)/)
})

await test('installer requires exact lowercase 40-character SHA and remote equality', async () => {
  const installer = await read('deploy/hetzner/install-kakapo-server-read.sh')
  assert.match(installer, /\[\[ \$\{APPROVED_SHA\} =~ \^\[0-9a-f\]\{40\}\$ \]\]/)
  assert.match(installer, /fetch --force --no-tags origin/)
  assert.match(installer, /\+refs\/heads\/release\/online-v1:refs\/remotes\/origin\/release\/online-v1/)
  assert.match(installer, /REMOTE_REF='refs\/remotes\/origin\/release\/online-v1'/)
  assert.match(installer, /\[\[ \$\{REMOTE_SHA\} == "\$\{APPROVED_SHA\}" \]\]/)
})

await test('installer sources artifacts from exact Git object, never mutable worktree', async () => {
  const installer = await read('deploy/hetzner/install-kakapo-server-read.sh')
  assert.match(installer, /SOURCE_URL='https:\/\/github\.com\/sayod820\/kakapo\.git'/)
  assert.match(installer, /git init --bare --quiet/)
  assert.match(installer, /GIT_CONFIG_NOSYSTEM=1/)
  assert.match(installer, /GIT_CONFIG_GLOBAL=\/dev\/null/)
  assert.match(installer, /GIT_CONFIG_COUNT=0/)
  assert.match(installer, /unset NODE_OPTIONS NODE_PATH/)
  assert.match(installer, /NPM_CONFIG_IGNORE_SCRIPTS=true/)
  assert.match(installer, /archive --format=tar "\$\{APPROVED_SHA\}" -- "\$\{ARTIFACTS\[@\]\}"/)
  assert.match(installer, /show "\$\{APPROVED_SHA\}:\$\{artifact\}"/)
  assert.match(installer, /installer is not the exact approved Git object/)
  assert(!/SOURCE_DIR=.*dirname|LIB_SOURCE=.*SOURCE_DIR/.test(installer))
  assert(!/\/opt\/kakapo(?:\s|['"]|\/\.git)/.test(installer))
})

await test('installer uses root staging and verifies hashes before/after copy', async () => {
  const installer = await read('deploy/hetzner/install-kakapo-server-read.sh')
  assert.match(installer, /mktemp -d '\/run\/kakapo-server-read-install\.XXXXXX'/)
  assert.match(installer, /'0:0:700'/)
  assert.match(installer, /expected=.*git[\s\S]*show[\s\S]*sha256sum/)
  assert.match(installer, /installed library hash mismatch/)
  assert.match(installer, /chown -R root:root/)
  assert.match(installer, /chmod -R go-w/)
  assert.match(installer, /new inspector sudoers entry failed full configuration validation and was rolled back/)
  assert.match(installer, /sudoers rollback did not restore a valid configuration/)
})

await test('sudoers grants only the read wrapper', async () => {
  const sudoers = (await read('deploy/hetzner/kakapo-server-read.sudoers')).trim().split(/\r?\n/)
  assert.equal(sudoers.length, 2)
  assert.equal(sudoers[1], 'kakapo-deploy ALL=(root) NOPASSWD: /usr/local/sbin/kakapo-server-read *')
  assert(!/\b(?:docker|psql|node|python|\/bin\/sh|\/bin\/bash)\b/.test(sudoers.join('\n')))
})

await test('wrapper cannot invoke shell passthrough and points only to root library', async () => {
  const wrapper = await read('deploy/hetzner/kakapo-server-read-wrapper')
  assert(!/\beval\b|\b(?:sudo|docker|psql|python|bash\s+-c|sh\s+-c)\b/.test(wrapper))
  assert.match(wrapper, /exec \/usr\/bin\/node \/usr\/local\/lib\/kakapo-server-read-current\/cli\.mjs "\$@"/)
})

await test('installer never writes existing deploy wrapper or deploy sudo rule', async () => {
  const installer = await read('deploy/hetzner/install-kakapo-server-read.sh')
  assert.match(installer, /DEPLOY_WRAPPER_HASH_BEFORE/)
  assert.match(installer, /existing deploy wrapper changed during install/)
  assert(!/(?:install|mv|cp)[^\r\n]*kakapo-deploy-online/.test(installer))
  assert(!/(?:install|mv|cp)[^\r\n]*sudoers[^\r\n]*deploy-online/.test(installer))
})

console.log(`\nKAKAPO SERVER READ R1.6 SECURITY: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
