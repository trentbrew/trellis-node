import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			$lib: path.join(appRoot, 'src/lib')
		}
	},
	test: {
		include: ['src/**/*.test.ts']
	}
});
