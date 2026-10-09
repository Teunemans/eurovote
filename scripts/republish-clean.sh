#!/usr/bin/env bash
# Removes your real name and e-mail from EuroVote's git history by starting over:
#   1. sets this project's git identity to your GitHub username + GitHub's private "noreply" e-mail
#   2. deletes the local git history (your files stay exactly as they are)
#   3. deletes the repository on GitHub (the only way to make the old commits truly gone:
#      after a force-push, GitHub keeps old commits reachable by their ID)
#   4. publishes again with ./scripts/publish.sh (new repository, one clean commit)
#
# The site is offline for a minute or two in between.

set -euo pipefail
cd "$(dirname "$0")/.."

REPO_NAME="${1:-eurovote}"
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

command -v gh >/dev/null || fail "The GitHub CLI (gh) is not installed: brew install gh"
gh auth status >/dev/null 2>&1 || fail "Log in first: gh auth login"

LOGIN="$(gh api user --jq .login)"
ID="$(gh api user --jq .id)"
NOREPLY="${ID}+${LOGIN}@users.noreply.github.com"

echo "This will:"
echo "  • use \"$LOGIN <$NOREPLY>\" for commits in this project"
echo "  • delete the local git history (your files are kept)"
echo "  • DELETE github.com/$LOGIN/$REPO_NAME and create it again (cannot be undone)"
read -r -p "Type the repository name ($REPO_NAME) to continue: " ANSWER
[ "$ANSWER" = "$REPO_NAME" ] || fail "Stopped, nothing was changed."

step "1/4  Your new git identity for this project"
# Saved in .git/config only. To use it for ALL your projects, run the same two
# commands with --global (after this script, because step 2 deletes .git/config).
echo "    $LOGIN <$NOREPLY>"

step "2/4  Deleting the local git history"
rm -rf .git
git init -q -b main
git config user.name "$LOGIN"
git config user.email "$NOREPLY"
echo "    Fresh repository created."

step "3/4  Deleting github.com/$LOGIN/$REPO_NAME"
if gh repo view "$LOGIN/$REPO_NAME" >/dev/null 2>&1; then
  if ! gh repo delete "$LOGIN/$REPO_NAME" --yes 2>/tmp/eurovote-delete.log; then
    if grep -q "delete_repo" /tmp/eurovote-delete.log; then
      echo "    GitHub needs one extra permission (delete_repo); a browser window will open."
      gh auth refresh -h github.com -s delete_repo
      gh repo delete "$LOGIN/$REPO_NAME" --yes
    else
      cat /tmp/eurovote-delete.log; fail "Could not delete the repository."
    fi
  fi
  echo "    Deleted."
  sleep 3 # give GitHub a moment before creating a repository with the same name
else
  echo "    It doesn't exist (anymore), nothing to delete."
fi

step "4/4  Publishing again"
./scripts/publish.sh "$REPO_NAME"

echo
echo "Check:  git log --format='%an <%ae>'   should only show $LOGIN <$NOREPLY>"
echo "Also tick 'Keep my email addresses private' on GitHub: Settings → Emails."
