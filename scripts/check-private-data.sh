#!/bin/sh
# Blocks commits that would publish private work data (meeting topics, notes, chat links).
# Real topics live only in Supabase (user_profiles.topics_md) — never in this public repo.
#
# Generic patterns are below. Add your own terms (company, colleagues, projects), one
# regex per line, to the gitignored .private-patterns file so they stay off GitHub too.

PATTERNS='notes\.granola\.ai|[a-z0-9-]+\.slack\.com/archives|docs\.google\.com/(document|spreadsheets|presentation)/d/'
if [ -f .private-patterns ]; then
  EXTRA=$(grep -vE '^\s*(#|$)' .private-patterns | paste -sd'|' -)
  [ -n "$EXTRA" ] && PATTERNS="$PATTERNS|$EXTRA"
fi

# Any real TOPICS file staged (the example file is the only allowed one)
TOPICS=$(git diff --cached --name-only --diff-filter=AM | grep -E '(^|/)TOPICS[^/]*\.md$' | grep -v '^sync/TOPICS.example.md$')
if [ -n "$TOPICS" ]; then
  echo "✋  Refusing to commit a TOPICS file — real topics belong in Supabase only:"
  echo "$TOPICS"
  exit 1
fi

HITS=$(git diff --cached -U0 --diff-filter=AM -- . ':!package-lock.json' | grep -E '^\+[^+]' | grep -inE "$PATTERNS")
if [ -n "$HITS" ]; then
  echo "✋  Staged changes contain private work data (see scripts/check-private-data.sh):"
  echo "$HITS" | cut -c1-160
  exit 1
fi
