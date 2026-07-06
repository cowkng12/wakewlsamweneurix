#!/usr/bin/env node
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const templateRoot = path.resolve(__dirname, '..')
const cli = parseArgs(process.argv.slice(2))
const configPath = cli.configPath
const force = cli.force
const renderApiBaseUrl = 'https://api.render.com/v1'

const excludedPaths = new Set([
  '.git',
  'node_modules',
  'dist',
  'data',
  '.env',
  'factory',
])

const textExtensions = new Set([
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.svg',
  '.toml',
  '.txt',
  '.yaml',
  '.yml',
])

function usage() {
  console.error('Usage: node factory/create-bot-site.js <config.json> [--env secrets.env] [--force]')
  process.exit(1)
}

function parseArgs(args) {
  const result = {
    configPath: '',
    envFile: '',
    force: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--force') {
      result.force = true
      continue
    }

    if (arg === '--env') {
      result.envFile = args[index + 1] || ''
      index += 1
      continue
    }

    if (arg.startsWith('--env=')) {
      result.envFile = arg.slice('--env='.length)
      continue
    }

    if (!arg.startsWith('--') && !result.configPath) {
      result.configPath = arg
      continue
    }
  }

  return result
}

function requireValue(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required config value: ${name}`)
  }

  return value.trim()
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function compactSlug(value) {
  return slugify(value).replace(/-/g, '')
}

function normalizeHex(value, fallback) {
  const normalized = String(value || fallback).trim()
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback
}

function renderString(value) {
  return JSON.stringify(String(value))
}

function sellerUsernameFromUrl(value) {
  const rawValue = String(value || '').trim()

  try {
    const url = new URL(rawValue)
    const username = url.pathname.split('/').filter(Boolean).pop()
    return username || 'seller'
  } catch {
    return rawValue.replace(/^@/, '') || 'seller'
  }
}

function parseEnvValue(value) {
  const trimmed = value.trim()

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

async function loadEnvFile(envFilePath) {
  if (!envFilePath) {
    return
  }

  const resolvedPath = path.resolve(envFilePath)

  if (!fsSync.existsSync(resolvedPath)) {
    throw new Error(`Env file not found: ${resolvedPath}`)
  }

  const content = await fs.readFile(resolvedPath, 'utf8')
  let loadedCount = 0

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      return
    }

    const separatorIndex = trimmed.indexOf('=')

    if (separatorIndex === -1) {
      return
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1))

    if (!key) {
      return
    }

    process.env[key] = value
    loadedCount += 1
  })

  console.log(`Loaded ${loadedCount} env values from ${resolvedPath}`)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  })

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`)
  }

  return result.stdout.trim()
}

function configValue(value) {
  if (value === undefined || value === null) {
    return ''
  }

  return String(value).trim()
}

function secretValue(source) {
  if (!source) {
    return ''
  }

  if (typeof source === 'string') {
    return configValue(process.env[source])
  }

  if (source.value !== undefined) {
    return configValue(source.value)
  }

  if (source.env) {
    return configValue(process.env[source.env])
  }

  return ''
}

function renderApiKey(config) {
  const apiKeyEnv = config.render?.apiKeyEnv || config.render?.api?.apiKeyEnv || 'RENDER_API_KEY'
  return configValue(process.env[apiKeyEnv])
}

async function renderRequest(apiKey, method, endpoint, body) {
  const response = await globalThis.fetch(`${renderApiBaseUrl}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const responseText = await response.text()
  let data = null

  if (responseText) {
    try {
      data = JSON.parse(responseText)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || responseText || response.statusText
    throw new Error(`Render API ${method} ${endpoint} failed: ${response.status} ${message}`)
  }

  return data
}

function renderEnvVars(config, values, includeSupabase) {
  const envVars = new Map([
    ['NODE_ENV', 'production'],
    ['WEB_APP_URL', values.webAppUrl],
    ['ACTIVATION_SITE_URL', values.activationSiteUrl],
    ['SELLER_URL', values.sellerUrl],
    ['REQUIRED_CHANNEL_USERNAME', values.telegramChannelUsername],
    ['REQUIRED_CHANNEL_URL', values.telegramChannelUrl],
    ['CRYPTO_PAY_API_URL', 'https://pay.crypt.bot/api'],
    ['CRYPTO_PAY_ASSET', 'USDT'],
    ['SUPABASE_STORE_KEY', values.storeKey],
    ['ACCOUNT_DELIVERY_THRESHOLD', '0.1'],
  ])

  Object.entries(config.render?.envVars || {}).forEach(([key, value]) => {
    envVars.set(key, configValue(value))
  })

  const secretSources = {
    TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
    ADMIN_CHAT_ID: 'ADMIN_CHAT_ID',
    CRYPTO_PAY_TOKEN: 'CRYPTO_PAY_TOKEN',
    ...(includeSupabase ? {
      SUPABASE_URL: 'SUPABASE_URL',
      SUPABASE_SERVICE_ROLE_KEY: 'SUPABASE_SERVICE_ROLE_KEY',
    } : {}),
    ...(config.secrets || {}),
  }

  const missingSecrets = []

  Object.entries(secretSources).forEach(([key, source]) => {
    const value = secretValue(source)

    if (!value) {
      missingSecrets.push(key)
      return
    }

    envVars.set(key, value)
  })

  return {
    envVars: Array.from(envVars, ([key, value]) => ({ key, value })),
    missingSecrets,
  }
}

async function resolveRenderOwnerId(config, apiKey) {
  const renderConfig = config.render || {}

  if (renderConfig.ownerId) {
    return renderConfig.ownerId
  }

  const owners = await renderRequest(apiKey, 'GET', '/owners?limit=100')
  const ownerRecords = owners.map((item) => item.owner).filter(Boolean)

  if (renderConfig.workspaceName) {
    const owner = ownerRecords.find((item) => item.name === renderConfig.workspaceName)

    if (!owner) {
      throw new Error(`Render workspace not found: ${renderConfig.workspaceName}`)
    }

    return owner.id
  }

  if (renderConfig.workspaceEmail) {
    const owner = ownerRecords.find((item) => item.email === renderConfig.workspaceEmail)

    if (!owner) {
      throw new Error(`Render workspace email not found: ${renderConfig.workspaceEmail}`)
    }

    return owner.id
  }

  if (ownerRecords.length === 1) {
    return ownerRecords[0].id
  }

  throw new Error('Set render.ownerId or render.workspaceName in config. Render API key has access to multiple workspaces.')
}

async function findRenderService(config, values, apiKey, ownerId) {
  const params = new URLSearchParams({
    name: values.renderServiceName,
    type: 'web_service',
    ownerId,
    limit: '100',
  })
  const services = await renderRequest(apiKey, 'GET', `/services?${params}`)
  const match = services
    .map((item) => item.service)
    .find((service) => service?.name === values.renderServiceName && service?.ownerId === ownerId)

  return match || null
}

async function createRenderService(config, values, apiKey, ownerId, envVars) {
  const renderConfig = config.render || {}
  const serviceDetails = {
    runtime: 'node',
    plan: renderConfig.plan || 'free',
    region: renderConfig.region || 'virginia',
    healthCheckPath: renderConfig.healthCheckPath || '/health',
    numInstances: Number(renderConfig.numInstances || 1),
    envSpecificDetails: {
      buildCommand: renderConfig.buildCommand || 'npm install && npm run build',
      startCommand: renderConfig.startCommand || 'npm start',
    },
  }
  const payload = {
    type: 'web_service',
    name: values.renderServiceName,
    ownerId,
    repo: values.repoUrl,
    branch: renderConfig.branch || 'main',
    autoDeploy: renderConfig.autoDeploy === false ? 'no' : 'yes',
    envVars,
    serviceDetails,
  }

  if (renderConfig.rootDir) {
    payload.rootDir = renderConfig.rootDir
  }

  const result = await renderRequest(apiKey, 'POST', '/services', payload)
  return result.service
}

async function upsertRenderEnvVars(apiKey, serviceId, envVars) {
  for (const { key, value } of envVars) {
    await renderRequest(
      apiKey,
      'PUT',
      `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`,
      { value },
    )
  }
}

async function deployRenderService(apiKey, serviceId) {
  await renderRequest(apiKey, 'POST', `/services/${encodeURIComponent(serviceId)}/deploys`, {
    clearCache: 'do_not_clear',
  })
}

async function setupRender(config, values, includeSupabase) {
  if (!config.render?.api?.enabled) {
    return null
  }

  const apiKey = renderApiKey(config)

  if (!apiKey) {
    throw new Error(`Missing Render API key. Set ${config.render?.apiKeyEnv || config.render?.api?.apiKeyEnv || 'RENDER_API_KEY'} in your shell.`)
  }

  if (!values.repoUrl) {
    throw new Error('Render API setup requires github.owner and github.repo or render.repoUrl.')
  }

  const ownerId = await resolveRenderOwnerId(config, apiKey)
  const { envVars, missingSecrets } = renderEnvVars(config, values, includeSupabase)
  let service = null

  if (missingSecrets.length && config.render.api.failOnMissingSecrets !== false) {
    throw new Error(`Missing local secret env values: ${missingSecrets.join(', ')}`)
  }

  if (config.render.api.reuseExisting !== false) {
    service = await findRenderService(config, values, apiKey, ownerId)
  }

  if (!service) {
    service = await createRenderService(config, values, apiKey, ownerId, envVars)
    console.log(`Render service created: ${service.id}`)
  } else {
    console.log(`Render service exists: ${service.id}`)
  }

  await upsertRenderEnvVars(apiKey, service.id, envVars)

  if (missingSecrets.length) {
    console.warn(`Skipped missing local secret env values: ${missingSecrets.join(', ')}`)
  }

  if (config.render.api.deploy !== false) {
    await deployRenderService(apiKey, service.id)
  }

  return service
}

function shouldSkip(sourcePath) {
  const relativePath = path.relative(templateRoot, sourcePath).replace(/\\/g, '/')
  const [topLevel] = relativePath.split('/')
  return excludedPaths.has(relativePath) || excludedPaths.has(topLevel)
}

async function copyTemplate(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true })
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)

    if (shouldSkip(sourcePath)) {
      continue
    }

    const targetPath = path.join(targetDir, path.relative(templateRoot, sourcePath))

    if (entry.isDirectory()) {
      await copyTemplate(sourcePath, targetDir)
      continue
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.copyFile(sourcePath, targetPath)
  }
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...await listFiles(filePath))
      continue
    }

    files.push(filePath)
  }

  return files
}

async function replaceInTextFiles(targetDir, replacements) {
  const files = await listFiles(targetDir)

  for (const file of files) {
    const extension = path.extname(file).toLowerCase()

    if (!textExtensions.has(extension)) {
      continue
    }

    let content = await fs.readFile(file, 'utf8')
    let nextContent = content

    for (const [from, to] of replacements) {
      nextContent = nextContent.split(from).join(to)
    }

    if (nextContent !== content) {
      await fs.writeFile(file, nextContent)
    }
  }
}

async function updatePackageFiles(targetDir, packageName) {
  const packagePath = path.join(targetDir, 'package.json')
  const packageLockPath = path.join(targetDir, 'package-lock.json')
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'))
  packageJson.name = packageName

  if (packageJson.scripts) {
    delete packageJson.scripts['create:bot-site']
    delete packageJson.scripts['launch:bot-site']
  }

  await fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

  if (fsSync.existsSync(packageLockPath)) {
    const packageLock = JSON.parse(await fs.readFile(packageLockPath, 'utf8'))
    packageLock.name = packageName

    if (packageLock.packages?.['']) {
      packageLock.packages[''].name = packageName
    }

    await fs.writeFile(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`)
  }
}

async function removeFactoryDocs(targetDir) {
  const readmePath = path.join(targetDir, 'README.md')

  if (!fsSync.existsSync(readmePath)) {
    return
  }

  const content = await fs.readFile(readmePath, 'utf8')
  const nextContent = content.replace(/\n?<!-- FACTORY_DOCS_START -->[\s\S]*?<!-- FACTORY_DOCS_END -->\n?/g, '\n')
  await fs.writeFile(readmePath, nextContent.trimEnd() + '\n')
}

async function writeEnvExample(targetDir, values) {
  const lines = [
    `VITE_SELLER_URL=${values.sellerUrl}`,
    'VITE_API_BASE_URL=http://localhost:3001',
    'TELEGRAM_BOT_TOKEN=your_bot_token',
    'ADMIN_CHAT_ID=your_admin_chat_id',
    `WEB_APP_URL=${values.webAppUrl}`,
    `SELLER_URL=${values.sellerUrl}`,
    `REQUIRED_CHANNEL_USERNAME=${values.telegramChannelUsername}`,
    `REQUIRED_CHANNEL_URL=${values.telegramChannelUrl}`,
    'CRYPTO_PAY_TOKEN=your_crypto_pay_token',
    'CRYPTO_PAY_API_URL=https://pay.crypt.bot/api',
    'CRYPTO_PAY_ASSET=USDT',
    'STORE_FILE_PATH=./data/store.json',
    'SUPABASE_URL=https://your-project.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key',
    `SUPABASE_STORE_KEY=${values.storeKey}`,
    'ACCOUNT_DELIVERY_THRESHOLD=0.1',
    `ACTIVATION_SITE_URL=${values.activationSiteUrl}`,
  ]

  await fs.writeFile(path.join(targetDir, '.env.example'), `${lines.join('\n')}\n`)
}

async function writeRenderYaml(targetDir, values, includeSupabase) {
  const envVars = [
    ['NODE_ENV', 'production'],
    ['WEB_APP_URL', values.webAppUrl],
    ['ACTIVATION_SITE_URL', values.activationSiteUrl],
    ['SELLER_URL', values.sellerUrl],
    ['REQUIRED_CHANNEL_USERNAME', values.telegramChannelUsername],
    ['REQUIRED_CHANNEL_URL', values.telegramChannelUrl],
    ['CRYPTO_PAY_API_URL', 'https://pay.crypt.bot/api'],
    ['CRYPTO_PAY_ASSET', 'USDT'],
    ['SUPABASE_STORE_KEY', values.storeKey],
    ['ACCOUNT_DELIVERY_THRESHOLD', '0.1'],
  ]

  const secretVars = [
    'TELEGRAM_BOT_TOKEN',
    'ADMIN_CHAT_ID',
    'CRYPTO_PAY_TOKEN',
  ]

  if (includeSupabase) {
    secretVars.push('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
  }

  const lines = [
    'services:',
    '  - type: web',
    `    name: ${values.renderServiceName}`,
    '    env: node',
    '    plan: free',
    '    buildCommand: npm install && npm run build',
    '    startCommand: npm start',
    '    healthCheckPath: /health',
    '    autoDeploy: true',
    '    envVars:',
    ...envVars.flatMap(([key, value]) => [
      `      - key: ${key}`,
      `        value: ${renderString(value)}`,
    ]),
    ...secretVars.flatMap((key) => [
      `      - key: ${key}`,
      '        sync: false',
    ]),
  ]

  await fs.writeFile(path.join(targetDir, 'render.yaml'), `${lines.join('\n')}\n`)
}

async function writeFavicon(targetDir, values) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#F0F9FF"/>
  <path d="M36.6 10.5C45.9 12 52 18.2 53.5 27.4L38.2 42.7 21.3 25.8 36.6 10.5Z" fill="#E0F2FE" stroke="${values.colors.bright}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M20.6 27.3 10.9 31.1 18.9 39.1 22.7 29.4M36.7 43.4 24.9 47.1 32.9 55.1 36.7 45.4" stroke="${values.colors.primary}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M25.8 38.2 15.8 48.2" stroke="${values.colors.bright}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="39.7" cy="24.3" r="4.1" fill="#FFFFFF" stroke="${values.colors.bright}" stroke-width="3"/>
</svg>
`

  await fs.writeFile(path.join(targetDir, 'public', 'favicon.svg'), svg)
}

function resolveValues(config) {
  const projectName = requireValue(config.projectName, 'projectName')
  const storeKey = compactSlug(config.storeKey || config.brandSlug || projectName)
  const packageName = config.packageName || `${storeKey}-miniapp`
  const renderServiceName = config.render?.serviceName || config.github?.repo || packageName
  const webAppUrl = config.render?.webAppUrl || `https://${renderServiceName}.onrender.com`
  const telegramChannelUsername = config.telegram?.channelUsername || `@${projectName.replace(/[^a-z0-9_]/gi, '')}`
  const telegramChannelUrl = config.telegram?.channelUrl || `https://t.me/${telegramChannelUsername.replace(/^@/, '')}`
  const repoUrl = config.render?.repoUrl || (config.github?.owner && config.github?.repo ? `https://github.com/${config.github.owner}/${config.github.repo}` : '')

  return {
    projectName,
    storeKey,
    packageName,
    renderServiceName,
    repoUrl,
    webAppUrl,
    activationSiteUrl: config.render?.activationSiteUrl || `${webAppUrl.replace(/\/$/, '')}/activate`,
    targetDir: path.resolve(config.targetDir || path.join(path.dirname(templateRoot), config.folderName || projectName)),
    sellerUrl: config.sellerUrl || 'https://t.me/metifrysell',
    sellerUsername: config.sellerUsername || sellerUsernameFromUrl(config.sellerUrl || 'https://t.me/metifrysell'),
    telegramChannelUsername,
    telegramChannelUrl,
    promoPrefix: String(config.promoPrefix || storeKey).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    colors: {
      primary: normalizeHex(config.colors?.primary, '#2563eb'),
      bright: normalizeHex(config.colors?.bright, '#38bdf8'),
      deep: normalizeHex(config.colors?.deep, '#1d4ed8'),
    },
  }
}

async function prepareTargetDirectory(targetDir, allowForce) {
  if (!fsSync.existsSync(targetDir)) {
    await fs.mkdir(targetDir, { recursive: true })
    return
  }

  const entries = await fs.readdir(targetDir)

  if (!entries.length) {
    return
  }

  if (!allowForce) {
    throw new Error(`Target directory is not empty: ${targetDir}. Use --force only if you want to replace it.`)
  }

  await fs.rm(targetDir, { recursive: true, force: true })
  await fs.mkdir(targetDir, { recursive: true })
}

function setupGit(targetDir, config, values) {
  const gitConfig = config.git || {}

  if (!gitConfig.init) {
    return
  }

  run('git', ['init', '-b', 'main'], targetDir)
  run('git', ['add', '.'], targetDir)
  run('git', ['commit', '-m', gitConfig.commitMessage || `Prepare ${values.projectName} mini app`], targetDir)

  const owner = config.github?.owner
  const repo = config.github?.repo

  if (!owner || !repo) {
    return
  }

  if (config.github?.createRepo) {
    run('gh', [
      'repo',
      'create',
      `${owner}/${repo}`,
      config.github.visibility === 'private' ? '--private' : '--public',
      '--source',
      targetDir,
      '--remote',
      'origin',
    ], targetDir)
  } else {
    run('git', ['remote', 'add', 'origin', `https://github.com/${owner}/${repo}.git`], targetDir)
  }

  if (config.github?.push) {
    run('git', ['push', '-u', 'origin', 'main'], targetDir)
  }
}

if (!configPath) {
  usage()
}

try {
  const resolvedConfigPath = path.resolve(configPath)
  const config = JSON.parse(await fs.readFile(resolvedConfigPath, 'utf8'))
  const configEnvFile = config.envFile ? path.resolve(path.dirname(resolvedConfigPath), config.envFile) : ''
  await loadEnvFile(cli.envFile || configEnvFile)

  const values = resolveValues(config)
  const includeSupabase = Boolean(config.supabase?.includeInRender)

  await prepareTargetDirectory(values.targetDir, force || config.force)
  await copyTemplate(templateRoot, values.targetDir)

  await replaceInTextFiles(values.targetDir, [
    ['nervahub-miniapp', values.packageName],
    ['NervaHub', values.projectName],
    ['nervahub', values.storeKey],
    ['NERVA', values.promoPrefix],
    ['https://t.me/metifrysell', values.sellerUrl],
    ['metifrysell', values.sellerUsername],
    ['@NervaHub', values.telegramChannelUsername],
    ['https://t.me/NervaHub', values.telegramChannelUrl],
    ['#2563eb', values.colors.primary],
    ['#2563EB', values.colors.primary.toUpperCase()],
    ['#38bdf8', values.colors.bright],
    ['#38BDF8', values.colors.bright.toUpperCase()],
    ['#1d4ed8', values.colors.deep],
    ['#1D4ED8', values.colors.deep.toUpperCase()],
  ])

  await updatePackageFiles(values.targetDir, values.packageName)
  await removeFactoryDocs(values.targetDir)
  await writeEnvExample(values.targetDir, values)
  await writeRenderYaml(values.targetDir, values, includeSupabase)
  await writeFavicon(values.targetDir, values)
  setupGit(values.targetDir, config, values)
  await setupRender(config, values, includeSupabase)

  console.log(`Created ${values.projectName} at ${values.targetDir}`)
  console.log(`Render service: ${values.renderServiceName}`)
  console.log(`Web app URL: ${values.webAppUrl}`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
