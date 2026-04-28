#!/usr/bin/env bash
set -e

BRANCH="${1:-main}"
MESSAGE="${2:-Auto update}"

echo "=== Git auto push started ==="

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: Not inside a git repository."
  exit 1
fi

# Finish existing rebase first, if one is already in progress.
if [ -d ".git/rebase-merge" ] || [ -d ".git/rebase-apply" ]; then
  echo "Existing rebase detected. Resolving conflicts by keeping YOUR local version..."

  while [ -d ".git/rebase-merge" ] || [ -d ".git/rebase-apply" ]; do
    CONFLICTS="$(git diff --name-only --diff-filter=U || true)"

    if [ -n "$CONFLICTS" ]; then
      echo "$CONFLICTS" | while read -r file; do
        [ -z "$file" ] && continue
        echo "Keeping local version: $file"
        git checkout --theirs -- "$file" || true
      done
      git add -A
    fi

    if git rebase --continue; then
      echo "Rebase step completed."
    else
      REMAINING="$(git diff --name-only --diff-filter=U || true)"
      if [ -z "$REMAINING" ]; then
        echo "Could not continue rebase automatically."
        echo "Run: git status"
        exit 1
      fi
    fi
  done
fi

echo "Switching to $BRANCH..."
git checkout "$BRANCH" || git checkout -B "$BRANCH"

echo "Adding all files..."
git add -A

if git diff --cached --quiet; then
  echo "No new changes to commit."
else
  git commit -m "$MESSAGE"
fi

echo "Fetching remote..."
git fetch origin "$BRANCH"

echo "Rebasing on origin/$BRANCH and keeping YOUR local version if conflicts happen..."
if ! git rebase "origin/$BRANCH"; then
  while [ -d ".git/rebase-merge" ] || [ -d ".git/rebase-apply" ]; do
    CONFLICTS="$(git diff --name-only --diff-filter=U || true)"

    if [ -n "$CONFLICTS" ]; then
      echo "$CONFLICTS" | while read -r file; do
        [ -z "$file" ] && continue
        echo "Keeping local version: $file"
        git checkout --theirs -- "$file" || true
      done
      git add -A
    fi

    if git rebase --continue; then
      echo "Rebase step completed."
    else
      REMAINING="$(git diff --name-only --diff-filter=U || true)"
      if [ -z "$REMAINING" ]; then
        echo "Could not continue rebase automatically."
        echo "Run: git status"
        exit 1
      fi
    fi
  done
fi

echo "Pushing to origin/$BRANCH..."
git push origin "$BRANCH"

echo "=== Done ==="
