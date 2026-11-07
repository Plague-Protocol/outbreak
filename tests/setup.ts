// Every test runs with the game's real task content (the file the game fetches at start).
import { readFileSync } from 'node:fs';
import { setContent, type Content } from '../src/core/content';

setContent(JSON.parse(readFileSync(new URL('../public/content/tasks.json', import.meta.url), 'utf8')) as Content);
