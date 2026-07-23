import { useMemo } from 'react';
import { parseDiff, Diff, Hunk, type FileData } from 'react-diff-view';

import 'react-diff-view/style/index.css';
import './git-diff-view.css';

type GitDiffViewerProps = {
  diff: string | null;
  /** Retained for call-site compatibility; the unified view already adapts. */
  isMobile?: boolean;
  wrapText: boolean;
};

// Guard against pathological diffs freezing the render thread. parseDiff walks
// the whole string, so cap what we hand it; a truncated tail still parses (the
// last hunk may be dropped) and we surface a notice.
const PREVIEW_CHARACTER_LIMIT = 400_000;

export default function GitDiffViewer({ diff, wrapText }: GitDiffViewerProps) {
  const { files, isTruncated, parseError } = useMemo(() => {
    if (!diff) {
      return { files: [] as FileData[], isTruncated: false, parseError: false };
    }
    const truncated = diff.length > PREVIEW_CHARACTER_LIMIT;
    const text = truncated ? diff.slice(0, PREVIEW_CHARACTER_LIMIT) : diff;
    try {
      // react-diff-view wants an actual unified diff; the git endpoint returns
      // one starting with `diff --git`. If the header is missing (some diffs are
      // emitted body-only), synthesize a minimal one so parseDiff still hunks it.
      const normalized = text.startsWith('diff ') || text.startsWith('--- ')
        ? text
        : `--- a\n+++ b\n${text}`;
      return { files: parseDiff(normalized), isTruncated: truncated, parseError: false };
    } catch {
      return { files: [] as FileData[], isTruncated: truncated, parseError: true };
    }
  }, [diff]);

  if (!diff) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No diff available
      </div>
    );
  }

  // parseError or an empty parse (e.g. binary/rename-only) → fall back to the
  // raw text so the user still sees something rather than a blank panel.
  if (parseError || files.length === 0 || files.every((file) => file.hunks.length === 0)) {
    return (
      <pre className="overflow-x-auto whitespace-pre px-3 py-2 font-mono text-xs text-muted-foreground/80">
        {diff}
      </pre>
    );
  }

  return (
    <div className={`git-diff-view ${wrapText ? 'git-diff-view--wrap' : ''}`}>
      {isTruncated && (
        <div className="mb-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Large diff preview: rendering is limited to keep the tab responsive.
        </div>
      )}
      {files.map((file, index) => (
        <Diff
          key={`${file.oldRevision}-${file.newRevision}-${index}`}
          viewType="unified"
          diffType={file.type}
          hunks={file.hunks}
        >
          {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
        </Diff>
      ))}
    </div>
  );
}
