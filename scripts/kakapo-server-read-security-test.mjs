/**
 * KAKAPO full server read access R1.6 security tests.
 * Local/mock/temp only. No SSH, Docker, sudo, PostgreSQL, production, or repo reports.
 * Run: node scripts/kakapo-server-read-security-test.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  MAX_COMMAND_BYTES,
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
  main,
  parseDockerPsRow,
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
  rejects(['containers', 'kakapo-nginx'])
})

await test('fixed container listing detects every allowlisted container and reports an absent one', async () => {
  const names = ['kakapo-api', 'kakapo-web', 'kakapo-nginx', 'kakapo-postgres']
  const calls = []
  const depsFor = absent => ({
    execFile: async (file, args) => {
      calls.push({ file, args })
      const filter = args[args.indexOf('--filter') + 1]
      const name = filter.slice('name=^/'.length, -1)
      return {
        stdout: name === absent
          ? ''
          : `${name}\tfixture/image:1\trunning\tUp 13 days\t13 days ago\n`,
        stderr: '',
      }
    },
  })

  const present = await executeCommand(parseCommand(['containers']), depsFor(null))
  assert.deepEqual(present.containers.map(row => row.name), names)
  assert(present.containers.every(row => row.found === true))
  assert.equal(present.containers.find(row => row.name === 'kakapo-nginx')?.found, true)

  calls.length = 0
  const absent = await executeCommand(parseCommand(['containers']), depsFor('kakapo-nginx'))
  assert.equal(absent.containers.find(row => row.name === 'kakapo-nginx')?.found, false)
  assert(absent.containers.filter(row => row.name !== 'kakapo-nginx').every(row => row.found === true))
  assert.equal(calls.length, names.length)
  for (const { file, args } of calls) {
    assert.equal(file, '/usr/bin/docker')
    assert.equal(args[0], 'ps')
    assert(!args.some(arg => /^(?:exec|run|restart|rm|compose|down|volume|prune)$/.test(arg)))
    assert(names.some(name => args.includes(`name=^/${name}$`)))
  }

  assert.equal(parseDockerPsRow('', 'kakapo-nginx'), null)
  assert.throws(
    () => parseDockerPsRow('kakapo-certbot\timage\trunning\tUp\t1 day', 'kakapo-nginx'),
    error => error instanceof PolicyError && error.code === 'CONTAINER_IDENTITY_MISMATCH',
  )
})

await test('container listing parses raw fixed output before redacting selected fields', async () => {
  const secret = 'docker-ps-secret-r2e'
  const result = await executeCommand(parseCommand(['containers']), {
    execFile: async (file, args, options) => {
      assert.equal(file, '/usr/bin/docker')
      assert.equal(options.shell, false)
      const filter = args[args.indexOf('--filter') + 1]
      const name = filter.slice('name=^/'.length, -1)
      return {
        stdout: `${name}\tpassword=${secret} detail\trunning\tUp 1 minute\t1 minute ago\n`,
        stderr: '',
      }
    },
  })
  const output = JSON.stringify(result)
  assert(!output.includes(secret))
  assert.match(output, /\[REDACTED\]/)
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

await test('structured Docker inspect parses before health-log redaction and exposes only projected fields', async () => {
  const healthSecret = 'health-secret-r2e'
  const bearerSecret = 'eyJabcdefghijk.abcdefghijklmnop.signature'
  const raw = JSON.stringify({
    id: '1234567890abcdef',
    name: '/kakapo-api',
    image: 'api:sha',
    created: 'now',
    state: {
      Status: 'running', Running: true, Error: `password=${healthSecret}`,
      Health: {
        Status: 'healthy', FailingStreak: 0,
        Log: [{
          Start: 'start', End: 'end', ExitCode: 0,
          Output: [
            `password=${healthSecret} detail with space`,
            `Authorization: Bearer ${bearerSecret}`,
            ...Array.from({ length: 8 }, (_, index) => `line-${index} ${'x'.repeat(300)}`),
          ].join('\n'),
        }],
      },
    },
  })

  assert.throws(() => JSON.parse(redactText(raw)))
  let captured
  const result = await executeCommand(parseCommand(['container-health', 'api']), {
    execFile: async (file, args, options) => {
      captured = { file, args, options }
      return { stdout: raw, stderr: '' }
    },
  })
  const json = JSON.stringify(result)
  assert.equal(result.container.name, 'kakapo-api')
  assert.equal(result.container.health.status, 'healthy')
  assert.match(result.container.health.lastChecks[0].output, /\[REDACTED\]/)
  assert.match(result.container.health.lastChecks[0].output, /\[TRUNCATED\]/)
  assert(result.container.health.lastChecks[0].output.split('\n').length <= 6)
  assert(Buffer.byteLength(result.container.health.lastChecks[0].output, 'utf8') <= 1024)
  assert(!json.includes(healthSecret))
  assert(!json.includes(bearerSecret))
  assert(!json.includes('state.Error'))
  assert.equal(result.container.state.errorPresent, true)
  assert.equal(captured.file, '/usr/bin/docker')
  assert.equal(captured.options.shell, false)
  assert.equal(captured.options.maxBuffer, MAX_COMMAND_BYTES)
  assert.deepEqual(Object.keys(captured.options.env).sort(), ['LANG', 'LC_ALL', 'PATH'])
  assert.deepEqual(captured.args.slice(0, 4), ['inspect', '--type', 'container', '--format'])
  assert.equal(captured.args.at(-1), 'kakapo-api')
  assert.match(captured.args[4], /\.State/)
  assert(!/Config\.Env|Mounts|{{json \.}}/.test(captured.args[4]))
})

await test('minimal structured inspect succeeds for every fixed container only', async () => {
  const expected = new Map([
    ['api', 'kakapo-api'],
    ['web', 'kakapo-web'],
    ['nginx', 'kakapo-nginx'],
    ['postgres', 'kakapo-postgres'],
  ])
  for (const [alias, name] of expected) {
    let captured
    const result = await executeCommand(parseCommand(['container-health', alias]), {
      execFile: async (file, args) => {
        captured = { file, args }
        return {
          stdout: JSON.stringify({
            id: 'abcdef1234567890', name: `/${name}`, image: `${alias}:fixture`, created: 'now',
            state: { Status: 'running', Running: true, Health: { Status: 'healthy', Log: [] } },
          }),
          stderr: '',
        }
      },
    })
    assert.equal(result.container.name, name)
    assert.equal(captured.file, '/usr/bin/docker')
    assert.equal(captured.args.at(-1), name)
    assert(!captured.args.some(arg => /^(?:exec|run|restart|rm|compose|down|volume|prune)$/.test(arg)))
  }
  rejects(['container-health', 'arbitrary'])
})

await test('malformed structured Docker output fails closed without leaking raw stdout', async () => {
  const rawSecret = 'raw-malformed-secret-r2e'
  let rendered = ''
  const exitCode = await main(['container-health', 'api'], {
    execFile: async () => ({ stdout: `{"name":"/kakapo-api","password":"${rawSecret}"`, stderr: rawSecret }),
    stderr: value => { rendered = value },
  })
  assert.equal(exitCode, 2)
  const response = JSON.parse(rendered)
  assert.equal(response.error.code, 'INVALID_DOCKER_RESPONSE')
  assert(!rendered.includes(rawSecret))

  rendered = ''
  const executionExitCode = await main(['container-health', 'api'], {
    execFile: async () => { throw new Error(`child failure ${rawSecret}`) },
    stderr: value => { rendered = value },
  })
  assert.equal(executionExitCode, 2)
  assert.equal(JSON.parse(rendered).error.code, 'STRUCTURED_COMMAND_FAILED')
  assert(!rendered.includes(rawSecret))
})

await test('oversized structured Docker output fails closed', async () => {
  await assert.rejects(
    executeCommand(parseCommand(['container-health', 'api']), {
      execFile: async () => ({ stdout: 'x'.repeat(MAX_COMMAND_BYTES + 1), stderr: '' }),
    }),
    error => error instanceof PolicyError && error.code === 'STRUCTURED_OUTPUT_TOO_LARGE',
  )
})

await test('Docker inspect projection cannot expose environment/mounts/commands', () => {
  const projected = sanitizeContainerInspect({
    id: '1234567890abcdef', name: '/kakapo-api', image: 'api:sha', created: 'now',
    state: { Status: 'running', Running: true, Health: { Status: 'healthy', Log: [] } },
  }, 'kakapo-api')
  const json = JSON.stringify(projected)
  assert(!/DATABASE_URL|\/root\/private|Labels|\/bin\/sh/.test(json))
})

await test('DB host is fixed private kakapo-net metadata', () => {
  const ip = extractPostgresContainerIp({
    name: '/kakapo-postgres', network: 'kakapo-net', ip: '172.19.0.2',
  })
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
        stdout: JSON.stringify({
          name: '/kakapo-postgres', network: 'kakapo-net', ip: '172.19.0.2',
        }),
        stderr: '',
      }
    },
    db: { config: dbConfig, poolFactory: async () => mocked.pool },
  })
  assert.equal(dockerCalls.length, 1)
  assert.equal(dockerCalls[0].file, '/usr/bin/docker')
  assert.deepEqual(dockerCalls[0].args.slice(0, 4), ['inspect', '--type', 'container', '--format'])
  assert.equal(dockerCalls[0].args.at(-1), 'kakapo-postgres')
  assert.match(dockerCalls[0].args[4], /kakapo-net/)
  assert(!/Config|Env|Mounts|{{json \.}}/.test(dockerCalls[0].args[4]))
})

await test('all CLI JSON parsing uses the internal structured path, never redacted stdout', async () => {
  const cli = await read('deploy/hetzner/kakapo-server-read/cli.mjs')
  assert(!/JSON\.parse\(result\.stdout\)/.test(cli))
  assert.match(cli, /async function runFixedRaw/)
  assert.match(cli, /async function runFixedStructured/)
  assert.match(cli, /return JSON\.parse\(stdout\)/)
  assert(!/return\s+\{?\s*stdout\s*[,}]/.test(cli.slice(cli.indexOf('async function runFixedStructured'), cli.indexOf('export function sanitizeContainerInspect'))))
  assert.match(cli, /async function dockerPs[\s\S]*runFixedRaw/)
  assert.match(cli, /async function checkUrl[\s\S]*runFixedRaw/)
})

await test('HTTP status uses fixed raw execution and validates before projection', async () => {
  let captured
  const result = await executeCommand(parseCommand(['health']), {
    execFile: async (file, args, options) => {
      captured = { file, args, options }
      return { stdout: '200', stderr: '' }
    },
  })
  assert.equal(result.httpStatus, 200)
  assert.equal(captured.file, '/usr/bin/curl')
  assert.equal(captured.options.shell, false)
  assert(captured.args.includes('%{http_code}'))

  const invalid = await executeCommand(parseCommand(['health']), {
    execFile: async () => ({ stdout: '200 password=raw-secret', stderr: 'raw-secret' }),
  })
  assert.equal(invalid.reachable, false)
  assert.equal(invalid.error, 'INVALID_HTTP_RESPONSE')
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
  assert.match(installer, /archive --format=tar "\$\{APPROVED_SHA\}" -- "\$\{ARTIFACTS\[@\]\}"/)
  assert.match(installer, /show "\$\{APPROVED_SHA\}:\$\{artifact\}"/)
  assert.match(installer, /installer is not the exact approved Git object/)
  assert(!/SOURCE_DIR=.*dirname|LIB_SOURCE=.*SOURCE_DIR/.test(installer))
  assert(!/\/opt\/kakapo(?:\s|['"]|\/\.git)/.test(installer))
})

await test('npm 10 rejects a shared user/global config while installer uses distinct root-stage files', async () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'kakapo-npm-config-'))
  try {
    const sameConfig = path.join(fixture, 'same.conf')
    const userConfig = path.join(fixture, 'user.conf')
    const globalConfig = path.join(fixture, 'global.conf')
    const cache = path.join(fixture, 'cache')
    await Promise.all([
      fs.writeFile(sameConfig, ''),
      fs.writeFile(userConfig, ''),
      fs.writeFile(globalConfig, ''),
      fs.mkdir(cache),
    ])

    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      ComSpec: process.env.ComSpec,
      PATHEXT: process.env.PATHEXT,
      TEMP: fixture,
      TMP: fixture,
    }
    const spawnOptions = { encoding: 'utf8', env, shell: process.platform === 'win32' }
    const version = spawnSync(npm, ['--version'], spawnOptions)
    assert.equal(version.status, 0, version.stderr)
    assert.match(version.stdout.trim(), /^10\./)

    const shared = spawnSync(npm, [
      'config', 'list',
      `--userconfig=${sameConfig}`,
      `--globalconfig=${sameConfig}`,
      `--cache=${cache}`,
      '--ignore-scripts',
    ], spawnOptions)
    assert.notEqual(shared.status, 0)
    assert.match(`${shared.stdout}\n${shared.stderr}`, /double-loading config/i)

    const distinct = spawnSync(npm, [
      'config', 'list',
      `--userconfig=${userConfig}`,
      `--globalconfig=${globalConfig}`,
      `--cache=${cache}`,
      '--ignore-scripts',
    ], spawnOptions)
    assert.equal(distinct.status, 0, distinct.stderr)

    const installer = await read('deploy/hetzner/install-kakapo-server-read.sh')
    assert.match(installer, /NPM_USER_CONFIG="\$\{ROOT_STAGE\}\/npm-user\.conf"/)
    assert.match(installer, /NPM_GLOBAL_CONFIG="\$\{ROOT_STAGE\}\/npm-global\.conf"/)
    assert.match(installer, /\[\[ ! \$\{NPM_USER_CONFIG\} -ef \$\{NPM_GLOBAL_CONFIG\} \]\]/)
    assert.match(installer, /stat -c '%u:%g:%a'[\s\S]*'0:0:600'/)
    assert.match(installer, /\/usr\/bin\/env -i/)
    assert.match(installer, /--userconfig="\$\{NPM_USER_CONFIG\}"/)
    assert.match(installer, /--globalconfig="\$\{NPM_GLOBAL_CONFIG\}"/)
    assert.match(installer, /--ignore-scripts/)
    assert.match(installer, /--omit=dev/)
    assert.match(installer, /--no-audit/)
    assert.match(installer, /--no-fund/)
    assert.match(installer, /--registry=https:\/\/registry\.npmjs\.org\//)
    assert(!/NPM_CONFIG_(?:USERCONFIG|GLOBALCONFIG)=\/dev\/null/.test(installer))
    assert(!/--userconfig=\/dev\/null|--globalconfig=\/dev\/null/.test(installer))
    const npmRun = installer.indexOf('/usr/bin/env -i')
    assert(npmRun > installer.indexOf('NPM_USER_CONFIG='))
    assert(npmRun > installer.indexOf('NPM_GLOBAL_CONFIG='))
    assert(npmRun < installer.indexOf('readonly LIB_TARGET='))
  } finally {
    await fs.rm(fixture, { recursive: true, force: true })
  }
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

await test('wrapper resolves only a root-owned canonical full-SHA CLI and keeps the CLI direct guard', async () => {
  const wrapper = await read('deploy/hetzner/kakapo-server-read-wrapper')
  const cli = await read('deploy/hetzner/kakapo-server-read/cli.mjs')
  assert(!/\beval\b|\b(?:sudo|docker|psql|python|bash\s+-c|sh\s+-c)\b/.test(wrapper))
  assert.match(wrapper, /CURRENT_LIB='\/usr\/local\/lib\/kakapo-server-read-current'/)
  assert.match(wrapper, /\[ -L "\$\{CURRENT_LIB\}" \]/)
  assert.match(wrapper, /REAL_CLI=\$\(\/usr\/bin\/readlink -f -- "\$\{CURRENT_LIB\}\/cli\.mjs"\)/)
  assert.match(wrapper, /\|\| fail 'CLI symlink target is missing'/)
  assert.match(wrapper, /\[ "\$\{#VERSION_SHA\}" -eq 40 \]/)
  assert.match(wrapper, /\*\[!0-9a-f\]\*\) fail/)
  assert.match(wrapper, /"\$\{REAL_CLI\}" = "\/usr\/local\/lib\/kakapo-server-read-\$\{VERSION_SHA\}\/cli\.mjs"/)
  assert.match(wrapper, /\[ -f "\$\{REAL_CLI\}" \] && \[ ! -L "\$\{REAL_CLI\}" \]/)
  assert.match(wrapper, /"0:0:644"|'0:0:644'/)
  assert.match(wrapper, /700\|701\|704\|705[\s\S]*754\|755/)
  assert.match(wrapper, /exec \/usr\/bin\/node "\$\{REAL_CLI\}" "\$@"/)
  assert.match(cli, /if \(import\.meta\.url === invokedPath\) process\.exitCode = await main\(\)/)
})

await test('canonicalized symlink entrypoint reaches main, emits status JSON, and missing targets fail closed', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'kakapo-wrapper-entry-'))
  try {
    const sourceDir = path.join(root, 'deploy', 'hetzner', 'kakapo-server-read')
    const current = path.join(fixture, 'kakapo-server-read-current')
    await fs.symlink(sourceDir, current, process.platform === 'win32' ? 'junction' : 'dir')
    const linkedCli = path.join(current, 'cli.mjs')
    const realCli = await fs.realpath(linkedCli)
    const expectedCli = await fs.realpath(path.join(sourceDir, 'cli.mjs'))
    assert.equal(realCli, expectedCli)
    assert.equal(pathToFileURL(realCli).href, pathToFileURL(expectedCli).href)

    const module = await import(`${pathToFileURL(realCli).href}?r2c=${Date.now()}`)
    let rendered = ''
    const exitCode = await module.main(['status'], {
      execFile: async file => ({ stdout: `${path.basename(file)} fixture`, stderr: '' }),
      stdout: value => { rendered = value },
    })
    assert.equal(exitCode, 0)
    const output = JSON.parse(rendered)
    assert.equal(output.ok, true)
    assert.equal(output.inspectorVersion, 'r1.6')
    assert.equal(output.readOnly, true)
    assert.equal(output.command, 'status')

    await assert.rejects(fs.realpath(path.join(fixture, 'missing-current', 'cli.mjs')))
    assert(!/^\/usr\/local\/lib\/kakapo-server-read-[0-9a-f]{40}\/cli\.mjs$/.test('/tmp/escape/cli.mjs'))
  } finally {
    await fs.rm(fixture, { recursive: true, force: true })
  }
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
