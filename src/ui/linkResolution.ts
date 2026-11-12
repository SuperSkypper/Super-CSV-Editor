/**
 * Whether a wikilink can be shown as resolved.
 *
 * Three answers, not two, because "the vault says no" and "there is nothing to
 * ask" must not look the same. A grid with no file yet has no source path to
 * resolve against, and every link in it would be greyed out if that case were
 * folded into "unresolved" — a lie the user cannot act on.
 */
export type LinkResolution = "resolved" | "unresolved" | "unknown";

/** The resolver Obsidian exposes for a link, narrowed to what is needed here. */
export type LinkResolver = (
	target: string,
	sourcePath: string,
) => object | null | undefined;

/**
 * Classifies `target` against the vault.
 *
 * `resolver` is `metadataCache.getFirstLinkpathDest`, whose signature is
 * `(linkpath, sourcePath)`. It is injected so this rule can be tested without
 * an Obsidian runtime.
 */
export function linkResolution(
	target: string,
	sourcePath: string | undefined,
	resolver: LinkResolver | undefined,
): LinkResolution {
	// No source path means no resolution context: report "unknown" rather than
	// marking a link the grid simply cannot judge.
	if (!sourcePath || !resolver) return "unknown";
	// An empty `[[]]` is not a link to anything, not a broken one.
	if (!target.trim()) return "unresolved";
	return resolver(target, sourcePath) ? "resolved" : "unresolved";
}
