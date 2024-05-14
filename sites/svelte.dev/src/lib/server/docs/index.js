import { base as app_base } from '$app/paths';
import {
	escape,
	extractFrontmatter,
	markedTransform,
	normalizeSlugify,
	removeMarkdown
} from '@sveltejs/site-kit/markdown';
import { CONTENT_BASE_PATHS } from '../../../constants.js';
import { render_content } from '../renderer';
import versions from '$lib/docs/versions.js';

/**
 * @param {import('./types').DocsData} docs_data
 * @param {string} slug
 */
export async function get_parsed_docs(docs_data, slug) {
	for (const { pages } of docs_data) {
		for (const page of pages) {
			if (page.slug === slug) {
				return {
					...page,
					content: await render_content(page.file, page.content)
				};
			}
		}
	}

	return null;
}

/**
 * @param {string} version
 * @return {Promise<import('./types').DocsData>}
 * */
export async function get_docs_data(version = undefined) {
	let base;
	if (versions.find((v) => v.version === version)) base = `./scripts/previous-docs/${version}/docs`;
	else base = CONTENT_BASE_PATHS.DOCS;

	const { readdir, readFile } = await import('node:fs/promises');

	/** @type {import('./types').DocsData} */
	const docs_data = [];

	for (const category_dir of await readdir(base)) {
		const match = /\d{2}-(.+)/.exec(category_dir);
		if (!match) continue;

		const category_slug = match[1];

		// Read the meta.json
		const { title: category_title, draft = 'false' } = JSON.parse(
			await readFile(`${base}/${category_dir}/meta.json`, 'utf-8')
		);

		if (draft === 'true') continue;

		/** @type {import('./types').Category} */
		const category = {
			title: category_title,
			slug: category_slug,
			pages: []
		};

		for (const filename of await readdir(`${base}/${category_dir}`)) {
			if (filename === 'meta.json') continue;
			const match = /\d{2}-(.+)\.md/.exec(filename);
			if (!match) continue;

			const page_slug = match[1];

			const page_data = extractFrontmatter(
				await readFile(`${base}/${category_dir}/${filename}`, 'utf-8')
			);

			if (page_data.metadata.draft === 'true') continue;

			const page_title = page_data.metadata.title;
			const page_content = page_data.body;

			category.pages.push({
				title: page_title,
				slug: page_slug,
				content: page_content,
				category: category_title,
				sections: await get_sections(page_content),
				path: `${app_base}/docs/${page_slug}`,
				file: `${category_dir}/${filename}`
			});
		}

		docs_data.push(category);
	}

	return docs_data;
}

/** @param {import('./types').DocsData} docs_data */
export function get_docs_list(docs_data) {
	return docs_data.map((category) => ({
		title: category.title,
		pages: category.pages.map((page) => ({
			title: page.title,
			path: page.path
		}))
	}));
}

/** @param {string} str */
const titled = async (str) =>
	removeMarkdown(
		escape(await markedTransform(str, { paragraph: (txt) => txt }))
			.replace(/<\/?code>/g, '')
			.replace(/&#39;/g, "'")
			.replace(/&quot;/g, '"')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&amp;/, '&')
			.replace(/<(\/)?(em|b|strong|code)>/g, '')
	);

/**
 * @param {string} markdown
 * @returns {Promise<import('./types').Section[]>}
 */
export async function get_sections(markdown) {
	const lines = markdown.split('\n');
	const root = /** @type {import('./types').Section} */ ({
		title: 'Root',
		slug: 'root',
		sections: [],
		breadcrumbs: [''],
		text: ''
	});
	let currentNodes = [root];

	for (const line of lines) {
		const match = line.match(/^(#{2,4})\s(.*)/);
		if (match) {
			const level = match[1].length - 2;
			const text = await titled(match[2]);
			const slug = normalizeSlugify(text);

			// Prepare new node
			/** @type {import('./types').Section} */
			const newNode = {
				title: text,
				slug,
				sections: [],
				breadcrumbs: [...currentNodes[level].breadcrumbs, text],
				text: ''
			};

			// Add the new node to the tree
			const sections = currentNodes[level].sections;
			if (!sections) throw new Error(`Could not find section ${level}`);
			sections.push(newNode);

			// Prepare for potential children of the new node
			currentNodes = currentNodes.slice(0, level + 1);
			currentNodes.push(newNode);
		} else if (line.trim() !== '') {
			// Add non-heading line to the text of the current section
			currentNodes[currentNodes.length - 1].text += line + '\n';
		}
	}

	return /** @type {import('./types').Section[]} */ (root.sections);
}
