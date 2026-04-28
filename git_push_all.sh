#!/usr/bin/env bash
set -e

BRANCH="${1:-main}"
MESSAGE="${2:-Auto update}"

echo "Checking repo..."
git rev-parse --is-inside-work-tree >/dev/null

CURRENT_BRANCH="$(git branch --show-current)"
echo "Current branch: $CURRENT_BRANCH"

echo "Saving all local changes..."
git add -A

if git diff --cached --quiet; then
  echo "No new file changes to commit."
else
  git commit -m "$MESSAGE"
fi

echo "Fetching latest remote..."
git fetch origin "$BRANCH"

echo "Rebasing local commits on top of origin/$BRANCH..."
if ! git rebase "origin/$BRANCH"; then
  echo ""
  echo "Rebase conflict detected."
  echo "Git cannot safely auto-resolve files changed in both local and remote."
  echo ""
  echo "To keep your local version for all conflicted files, run:"
  echo "  git diff --name-only --diff-filter=U | xargs git checkout --theirs --"
  echo "  git add -A"
  echo "  git rebase --continue"
  echo ""
  echo "Then run this script again:"
  echo "  ./git_push_all.sh $BRANCH \"$MESSAGE\""
  exit 1
fi

echo "Pushing to origin/$BRANCH..."
git push origin "$BRANCH"

echo "Done."
