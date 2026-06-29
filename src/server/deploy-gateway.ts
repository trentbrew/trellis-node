/**
 * Deploy Trellis MCP discovery gateway to Sprites.
 *
 * Provisions a lightweight Sprite running `startGatewayServer` — no room kernel.
 * Writes `.trellis-mcp-gateway.json` and uploads `.trellis-rooms.json` for discovery.
 *
 * @module trellis/server
 */

import { execFile } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { writeGatewayConfig } from '../mcp/gateway-config.js';
import {
  listRegisteredRooms,
  type RegisteredRoom,
} from '../mcp/room-registry.js';
import {
  buildDeployUrl,
  SPRITE_PUBLIC_HTTP_PORT,
  validateDeployName,
} from './deploy-meta.js';
import {
  assertSpriteCli,
  ensureSprite,
  ensureSpritePublicAccess,
  resolveSpritePublicUrl,
  runSpriteCopy,
  runSpriteExec,
  SPRITE_ENSURE_BUN_SH,
} from './sprites.js';

const GATEWAY_REMOTE_DIR = '/home/sprite/trellis-mcp-gateway';
const GATEWAY_SERVICE = 'trellis-mcp-gateway';

export interface DeployGatewayOptions {
  name: string;
  /** Vanity URL printed to agents (default: https://mcp.trellis.computer). */
  publicUrl?: string;
  port?: number;
  configDir?: string;
  /** Extra rooms JSON file (merged with local registry at deploy time). */
  roomsFile?: string;
  onProgress?: (msg: string) => void;
  stub?: boolean;
}

export interface DeployGatewayResult {
  url: string;
  publicUrl: string;
  name: string;
  roomCount: number;
}

export async function deployMcpGateway(
  opts: DeployGatewayOptions,
): Promise<DeployGatewayResult> {
  const { configDir = '.', onProgress = () => {} } = opts;
  const listenPort = opts.port ?? SPRITE_PUBLIC_HTTP_PORT;
  const name = validateDeployName(opts.name);
  const publicUrl = (opts.publicUrl ?? 'https://mcp.trellis.computer').replace(
    /\/$/,
    '',
  );

  const rooms = buildRoomsManifest(configDir, opts.roomsFile);
  onProgress(`Room registry: ${rooms.length} room(s)`);

  if (opts.stub) {
    const url = buildDeployUrl(name);
    onProgress('Stub deploy — skipping Sprites provisioning');
    writeGatewayConfig(
      {
        url,
        publicUrl,
        spriteName: name,
        deployedAt: new Date().toISOString(),
        port: listenPort,
      },
      configDir,
    );
    writeRoomsFile(configDir, rooms);
    return { url, publicUrl, name, roomCount: rooms.length };
  }

  onProgress('Checking Sprites CLI...');
  await assertSpriteCli();

  const tmpDir = resolve(configDir, '.trellis-deploy-gateway');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const entrypoint = join(tmpDir, 'gateway-entry.ts');
  writeFileSync(
    entrypoint,
    generateGatewayEntrypoint({ port: listenPort, publicUrl }),
  );

  onProgress('Bundling gateway with Bun...');
  const bundlePath = join(tmpDir, 'gateway.js');
  await runBun([
    'build',
    entrypoint,
    '--outfile',
    bundlePath,
    '--target',
    'bun',
    '--format',
    'esm',
  ]);

  onProgress(`Ensuring Sprite: ${name}...`);
  await ensureSprite(name);
  onProgress('Configuring public URL...');
  await ensureSpritePublicAccess(name);
  const url = await resolveSpritePublicUrl(name);

  onProgress('Uploading gateway bundle + room registry...');
  await runSpriteExec(name, `mkdir -p ${GATEWAY_REMOTE_DIR}`);
  await runSpriteCopy(bundlePath, name, `${GATEWAY_REMOTE_DIR}/gateway.js`);

  const roomsPath = join(tmpDir, 'rooms.json');
  writeFileSync(roomsPath, JSON.stringify(rooms, null, 2) + '\n', 'utf8');
  await runSpriteCopy(roomsPath, name, `${GATEWAY_REMOTE_DIR}/.trellis-rooms.json`);

  onProgress('Ensuring Bun is installed...');
  const bunPath = await runSpriteExec(name, SPRITE_ENSURE_BUN_SH);
  if (!bunPath.includes('bun')) {
    throw new Error(
      `Bun install failed on sprite ${name}: ${bunPath || '(no output)'}`,
    );
  }

  onProgress('Starting gateway (sprite-env service)...');
  const bun = bunPath.trim().split('\n').pop()!.trim();
  await runSpriteExec(
    name,
    `
export PATH="$HOME/.bun/bin:$PATH"
ENV="/.sprite/bin/sprite-env"
BUN="${bun}"
$ENV services delete ${GATEWAY_SERVICE} 2>/dev/null || true
$ENV services create ${GATEWAY_SERVICE} \\
  --cmd "$BUN" \\
  --args run,gateway.js \\
  --dir ${GATEWAY_REMOTE_DIR} \\
  --http-port ${listenPort} \\
  --no-stream
`.trim(),
  );

  onProgress('Waiting for health check...');
  await waitForHealth(url, 60_000);

  writeGatewayConfig(
    {
      url,
      publicUrl,
      spriteName: name,
      deployedAt: new Date().toISOString(),
      port: listenPort,
    },
    configDir,
  );
  writeRoomsFile(configDir, rooms);

  try {
    const { trackSprite } = await import('./vm-config.js');
    trackSprite(name, { url, hasTrellis: false });
  } catch {
    /* optional */
  }

  return { url, publicUrl, name, roomCount: rooms.length };
}

function buildRoomsManifest(
  configDir: string,
  roomsFile?: string,
): RegisteredRoom[] {
  const byUrl = new Map<string, RegisteredRoom>();
  for (const room of listRegisteredRooms({ configDir })) {
    byUrl.set(room.url, room);
  }

  if (roomsFile && existsSync(roomsFile)) {
    try {
      const extra = JSON.parse(readFileSync(roomsFile, 'utf8')) as
        | RegisteredRoom[]
        | { rooms?: RegisteredRoom[] };
      const list = Array.isArray(extra) ? extra : (extra.rooms ?? []);
      for (const room of list) {
        if (room.name && room.url) {
          byUrl.set(room.url, {
            ...room,
            mcpUrl: room.mcpUrl ?? `${room.url.replace(/\/$/, '')}/mcp`,
            source: room.source ?? 'registry',
          });
        }
      }
    } catch {
      /* ignore malformed rooms file */
    }
  }

  return [...byUrl.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function writeRoomsFile(configDir: string, rooms: RegisteredRoom[]): void {
  const path = resolve(configDir, '.trellis-rooms.json');
  writeFileSync(path, JSON.stringify(rooms, null, 2) + '\n', 'utf8');
}

function resolveGatewayImport(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Bundled CLI chunk: dist/gateway-deploy-cli-*.js; unbundled: src/server or dist/server
  const packageRoots = [
    resolve(here, '..'),
    resolve(here, '..', '..'),
  ];
  const tried: string[] = [];
  for (const packageRoot of packageRoots) {
    const candidates = [
      join(packageRoot, 'dist', 'mcp', 'gateway-serve.js'),
      join(packageRoot, 'src', 'mcp', 'gateway-serve.ts'),
    ];
    for (const candidate of candidates) {
      tried.push(candidate);
      if (existsSync(candidate)) {
        return resolve(candidate).replace(/\\/g, '/');
      }
    }
  }
  throw new Error(
    `gateway-serve module not found (tried: ${tried.join(', ')})`,
  );
}

function generateGatewayEntrypoint(opts: {
  port: number;
  publicUrl: string;
}): string {
  const mod = resolveGatewayImport();
  return `
import { startGatewayServer } from '${mod}';

process.env.TRELLIS_MCP_GATEWAY_PUBLIC_URL = '${opts.publicUrl}';
process.env.TRELLIS_ROOM_REGISTRY = '${GATEWAY_REMOTE_DIR}/.trellis-rooms.json';

await startGatewayServer({
  port: ${opts.port},
  configDir: '${GATEWAY_REMOTE_DIR}',
  publicUrl: '${opts.publicUrl}',
});

console.log('Trellis MCP gateway listening on port ${opts.port}');
console.log('Public URL: ${opts.publicUrl}');
`;
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `${url.replace(/\/$/, '')}/health`;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl);
      lastStatus = res.status;
      if (res.ok) {
        const body = (await res.json()) as { service?: string };
        if (body.service === 'trellis-mcp-gateway') return;
      }
    } catch {
      /* sprite waking */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `Gateway health check timed out (${healthUrl}${lastStatus ? `, last status ${lastStatus}` : ''})`,
  );
}

async function runBun(args: string[]): Promise<void> {
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('bun', args);
  } catch (err: any) {
    throw new Error(
      `bun ${args[0]} failed (exit ${err.code ?? '?'}): ${err.stderr ?? err.message}`,
    );
  }
}
