#!/usr/bin/env node
/**
 * WebContainer host — COOP/COEP + trellis dist bootstrap + app pack.
 *
 *   pnpm wc:host
 *   → open http://localhost:4500
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendAppPack } from '../scripts/wc-pack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
const trellisRoot = path.join(appRoot, '../../../TRELLIS/trellis-node');
const trellisDist = path.join(trellisRoot, 'dist');
const trellisBin = path.join(trellisRoot, 'bin/trellis.mjs');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript',
	'.mjs': 'application/javascript',
	'.json': 'application/json'
};

function packDir(dir, base = dir) {
	const result = {};
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		const rel = path.relative(base, full).replace(/\\/g, '/');
		if (entry.isDirectory()) {
			Object.assign(result, packDir(full, base));
		} else {
			const ext = path.extname(entry.name).toLowerCase();
			if (['.js', '.map', '.mjs'].includes(ext)) {
				result[rel] = fs.readFileSync(full, 'utf8');
			}
		}
	}
	return result;
}

const TRELLIS_VENDOR_PKG = {
	name: 'trellis',
	version: JSON.parse(fs.readFileSync(path.join(trellisRoot, 'package.json'), 'utf8')).version,
	type: 'module',
	exports: JSON.parse(fs.readFileSync(path.join(trellisRoot, 'package.json'), 'utf8')).exports,
	bin: { trellis: './bin/trellis.mjs' },
	dependencies: {
		'sql.js': '^1.14.1',
		commander: '^13.1.0',
		chalk: '^5.4.1',
		'@inquirer/prompts': '^8.2.2',
		zod: '3',
		ws: '^8.20.1'
	}
};

const server = http.createServer(async (req, res) => {
	res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
	res.setHeader('Access-Control-Allow-Origin', '*');

	const url = new URL(req.url ?? '/', 'http://localhost');
	const { pathname } = url;

	if (pathname === '/' || pathname === '/index.html') {
		res.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
		return;
	}

	if (pathname === '/api/trellis-bootstrap') {
		if (!fs.existsSync(trellisDist)) {
			res.statusCode = 503;
			res.setHeader('Content-Type', 'application/json');
			res.end(
				JSON.stringify({ error: 'trellis-node dist missing — run npm run build in trellis-node' })
			);
			return;
		}
		res.setHeader('Content-Type', 'application/json');
		res.end(
			JSON.stringify({
				vendorPackageJson: TRELLIS_VENDOR_PKG,
				binTrellis: fs.readFileSync(trellisBin, 'utf8'),
				dist: packDir(trellisDist)
			})
		);
		return;
	}

	if (pathname === '/api/app-pack') {
		sendAppPack(res);
		return;
	}

	res.statusCode = 404;
	res.end('Not found');
});

const PORT = Number(process.env.WC_HOST_PORT ?? 4500);
server.listen(PORT, '127.0.0.1', () => {
	console.log(`\n  WebContainer host → http://localhost:${PORT}`);
	console.log('  Requires trellis-node dist (../../../TRELLIS/trellis-node/dist)\n');
});
