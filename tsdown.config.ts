import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		'base-ui': 'src/lib/base-ui.ts',
		index: 'src/lib/index.ts',
	},
	tsconfig: 'tsconfig.lib.json',
	exports: true,
});
